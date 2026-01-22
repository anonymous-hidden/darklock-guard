/**
 * ChartManager - Production-grade Chart.js live update system
 * 
 * FIXES APPLIED:
 * - Single chart instance per canvas (no duplicate instances)
 * - Proper chart.update() instead of destroy/recreate
 * - Centralized WebSocket event handling
 * - Stale reference prevention via registry pattern
 * - Dataset mutation done correctly (in-place updates)
 * - Memory-safe cleanup on page unload
 * 
 * @version 2.0.0
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CHART REGISTRY - Single source of truth for all chart instances
    // ═══════════════════════════════════════════════════════════════════════════

    const ChartRegistry = {
        // Map of chartId -> Chart instance
        _instances: new Map(),
        
        // Map of chartId -> { canvasId, containerId, type, config }
        _configs: new Map(),
        
        // Initialization state
        _initialized: false,
        
        // WebSocket listener state
        _wsListenerAttached: false,
        
        // Pending update queue (debounce rapid updates)
        _pendingUpdates: new Map(),
        _updateDebounceMs: 100,

        /**
         * Register a chart configuration (call before creating charts)
         */
        registerChart(chartId, config) {
            this._configs.set(chartId, {
                canvasId: config.canvasId || chartId,
                containerId: config.containerId || `${chartId}-container`,
                type: config.type || 'line',
                options: config.options || {},
                datasets: config.datasets || [],
                labels: config.labels || []
            });
        },

        /**
         * Get a chart instance by ID
         */
        get(chartId) {
            return this._instances.get(chartId);
        },

        /**
         * Check if chart exists
         */
        has(chartId) {
            return this._instances.has(chartId);
        },

        /**
         * Store a chart instance
         */
        set(chartId, instance) {
            // Destroy existing instance first to prevent duplicates
            if (this._instances.has(chartId)) {
                this.destroy(chartId);
            }
            this._instances.set(chartId, instance);
        },

        /**
         * Safely destroy a chart instance
         */
        destroy(chartId) {
            const instance = this._instances.get(chartId);
            if (instance) {
                try {
                    instance.destroy();
                } catch (e) {
                    console.warn(`[ChartRegistry] Failed to destroy chart ${chartId}:`, e.message);
                }
                this._instances.delete(chartId);
            }
        },

        /**
         * Destroy all chart instances
         */
        destroyAll() {
            for (const chartId of this._instances.keys()) {
                this.destroy(chartId);
            }
            this._instances.clear();
        },

        /**
         * Get all chart IDs
         */
        getAll() {
            return Array.from(this._instances.keys());
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CHART MANAGER - Core update and creation logic
    // ═══════════════════════════════════════════════════════════════════════════

    const ChartManager = {
        
        // Default chart options for consistent styling
        defaultOptions: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(148, 163, 184, 0.2)',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(148, 163, 184, 0.1)', drawBorder: false },
                    ticks: { color: '#64748b', font: { size: 11 } }
                },
                y: {
                    grid: { color: 'rgba(148, 163, 184, 0.1)', drawBorder: false },
                    ticks: { color: '#64748b', font: { size: 11 }, stepSize: 1 },
                    beginAtZero: true
                }
            }
        },

        /**
         * Create or update a chart - THE CORE FUNCTION
         * This is the ONLY function that should touch chart instances
         * 
         * @param {string} chartId - Unique identifier for this chart
         * @param {Object} config - Chart configuration
         * @param {string} config.canvasId - Canvas element ID
         * @param {string} config.type - Chart type (line, bar, doughnut, etc)
         * @param {Array} config.labels - X-axis labels
         * @param {Array} config.datasets - Chart.js dataset array
         * @param {Object} config.options - Chart.js options (merged with defaults)
         * @returns {Chart|null} - The chart instance
         */
        createOrUpdate(chartId, config) {
            const canvas = document.getElementById(config.canvasId || chartId);
            if (!canvas) {
                console.warn(`[ChartManager] Canvas #${config.canvasId || chartId} not found`);
                return null;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.warn(`[ChartManager] Could not get 2D context for #${config.canvasId || chartId}`);
                return null;
            }

            // Check if we already have an instance for this canvas
            let chart = ChartRegistry.get(chartId);
            
            if (chart) {
                // UPDATE existing chart (don't recreate!)
                return this._updateExistingChart(chart, config);
            } else {
                // CREATE new chart instance
                return this._createNewChart(chartId, canvas, config);
            }
        },

        /**
         * Update an existing chart instance (no recreation)
         * @private
         */
        _updateExistingChart(chart, config) {
            try {
                // Update labels if provided
                if (config.labels) {
                    chart.data.labels = config.labels;
                }

                // Update datasets
                if (config.datasets && Array.isArray(config.datasets)) {
                    config.datasets.forEach((newDataset, index) => {
                        if (chart.data.datasets[index]) {
                            // Update existing dataset IN PLACE
                            // This is critical - don't replace the array, mutate it
                            const existingDataset = chart.data.datasets[index];
                            
                            // Update data array in place
                            if (newDataset.data) {
                                existingDataset.data.length = 0;
                                existingDataset.data.push(...newDataset.data);
                            }
                            
                            // Update other properties if needed
                            if (newDataset.label !== undefined) existingDataset.label = newDataset.label;
                            if (newDataset.backgroundColor !== undefined) existingDataset.backgroundColor = newDataset.backgroundColor;
                            if (newDataset.borderColor !== undefined) existingDataset.borderColor = newDataset.borderColor;
                        } else {
                            // Add new dataset if index doesn't exist
                            chart.data.datasets.push(newDataset);
                        }
                    });

                    // Remove extra datasets if new config has fewer
                    while (chart.data.datasets.length > config.datasets.length) {
                        chart.data.datasets.pop();
                    }
                }

                // Update chart without animation for live updates
                chart.update('none');
                
                return chart;
            } catch (e) {
                console.error(`[ChartManager] Failed to update chart:`, e);
                return chart;
            }
        },

        /**
         * Create a new chart instance
         * @private
         */
        _createNewChart(chartId, canvas, config) {
            try {
                // Merge options with defaults
                const mergedOptions = this._mergeDeep(
                    {},
                    this.defaultOptions,
                    config.options || {}
                );

                const chart = new Chart(canvas, {
                    type: config.type || 'line',
                    data: {
                        labels: config.labels || [],
                        datasets: config.datasets || []
                    },
                    options: mergedOptions
                });

                // Register the instance
                ChartRegistry.set(chartId, chart);
                
                console.log(`[ChartManager] Created new chart: ${chartId}`);
                return chart;
            } catch (e) {
                console.error(`[ChartManager] Failed to create chart ${chartId}:`, e);
                return null;
            }
        },

        /**
         * Update a chart with new data (convenience wrapper)
         * 
         * @param {string} chartId - The chart to update
         * @param {Array} labels - New labels
         * @param {Array} datasets - New dataset data (or array of data arrays)
         */
        updateChart(chartId, labels, datasets) {
            const chart = ChartRegistry.get(chartId);
            if (!chart) {
                console.warn(`[ChartManager] Chart ${chartId} not found for update`);
                return false;
            }

            // Normalize datasets input
            let normalizedDatasets;
            if (Array.isArray(datasets) && datasets.length > 0) {
                if (Array.isArray(datasets[0])) {
                    // Array of data arrays - map to dataset format
                    normalizedDatasets = datasets.map((data, i) => ({
                        data: data,
                        ...chart.data.datasets[i] // Preserve existing config
                    }));
                } else if (typeof datasets[0] === 'object' && datasets[0].data) {
                    // Already in dataset format
                    normalizedDatasets = datasets;
                } else {
                    // Single data array
                    normalizedDatasets = [{ data: datasets }];
                }
            }

            return this._updateExistingChart(chart, { labels, datasets: normalizedDatasets });
        },

        /**
         * Deep merge utility
         * @private
         */
        _mergeDeep(target, ...sources) {
            if (!sources.length) return target;
            const source = sources.shift();

            if (this._isObject(target) && this._isObject(source)) {
                for (const key in source) {
                    if (this._isObject(source[key])) {
                        if (!target[key]) Object.assign(target, { [key]: {} });
                        this._mergeDeep(target[key], source[key]);
                    } else {
                        Object.assign(target, { [key]: source[key] });
                    }
                }
            }
            return this._mergeDeep(target, ...sources);
        },

        _isObject(item) {
            return (item && typeof item === 'object' && !Array.isArray(item));
        },

        /**
         * Show or hide chart container based on data availability
         */
        toggleContainer(containerId, hasData) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (hasData) {
                container.style.display = '';
                container.classList.remove('no-data', 'chart-hidden');
                container.classList.add('chart-visible');
            } else {
                container.style.display = 'none';
                container.classList.add('no-data', 'chart-hidden');
                container.classList.remove('chart-visible');
            }
        },

        /**
         * Check if data array has meaningful values
         */
        hasData(data) {
            if (!data) return false;
            if (Array.isArray(data)) {
                return data.some(v => {
                    if (typeof v === 'number') return v > 0;
                    if (v && typeof v === 'object') return v.count > 0 || v.y > 0;
                    return false;
                });
            }
            return false;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // LIVE UPDATE HANDLER - WebSocket integration
    // ═══════════════════════════════════════════════════════════════════════════

    const LiveUpdateHandler = {
        
        // Debounce timer for batching rapid updates
        _updateTimer: null,
        _pendingData: null,

        /**
         * Initialize WebSocket listeners for live chart updates
         */
        init() {
            if (ChartRegistry._wsListenerAttached) {
                console.log('[LiveUpdateHandler] Already initialized');
                return;
            }

            // Listen for custom analytics_update event
            window.addEventListener('analytics_update', (event) => {
                this.handleAnalyticsUpdate(event.detail);
            });

            // Hook into existing WebSocket message handler
            this._hookWebSocketHandler();

            ChartRegistry._wsListenerAttached = true;
            console.log('[LiveUpdateHandler] Initialized');
        },

        /**
         * Hook into existing WebSocket message handlers
         * @private
         */
        _hookWebSocketHandler() {
            // Store reference to original handler
            const originalHandler = window.handleWebSocketMessage;
            
            window.handleWebSocketMessage = (data) => {
                // Call original handler first
                if (originalHandler && typeof originalHandler === 'function') {
                    originalHandler(data);
                }
                
                // Handle analytics updates
                if (data && data.type === 'analytics_update') {
                    this.handleAnalyticsUpdate(data.data || data);
                }
            };
        },

        /**
         * Handle incoming analytics update
         * Debounces rapid updates to prevent chart thrashing
         */
        handleAnalyticsUpdate(data) {
            if (!data) return;
            
            // Store latest data
            this._pendingData = data;
            
            // Debounce updates
            if (this._updateTimer) {
                clearTimeout(this._updateTimer);
            }
            
            this._updateTimer = setTimeout(() => {
                this._applyUpdate(this._pendingData);
                this._pendingData = null;
            }, 100);
        },

        /**
         * Apply the actual chart update
         * @private
         */
        _applyUpdate(data) {
            console.log('[LiveUpdateHandler] Applying analytics update');
            
            // Transform data to chart format and update each chart
            this._updateMessageChart(data);
            this._updateJoinLeaveChart(data);
            this._updateModerationChart(data);
            this._updateSpamChart(data);
            this._updateThreatChart(data);
        },

        /**
         * Update message activity chart
         * @private
         */
        _updateMessageChart(data) {
            if (!data.messages || !Array.isArray(data.messages)) return;
            
            const chartId = 'messageChart';
            const chart = ChartRegistry.get(chartId);
            if (!chart) return;
            
            const labels = data.messages.map(d => this._formatTimestamp(d.timestamp));
            const values = data.messages.map(d => d.count || 0);
            
            ChartManager.updateChart(chartId, labels, [values]);
            ChartManager.toggleContainer('messageChartContainer', ChartManager.hasData(values));
        },

        /**
         * Update join/leave chart
         * @private
         */
        _updateJoinLeaveChart(data) {
            const chartId = 'joinLeaveChart';
            const chart = ChartRegistry.get(chartId);
            if (!chart) return;
            
            const joins = data.joins || [];
            const leaves = data.leaves || [];
            
            // Use joins timestamps as labels (or generate hourly labels)
            const labels = joins.map(d => this._formatTimestamp(d.timestamp));
            const joinValues = joins.map(d => d.count || 0);
            const leaveValues = leaves.map(d => d.count || 0);
            
            ChartManager.updateChart(chartId, labels, [joinValues, leaveValues]);
            ChartManager.toggleContainer('joinLeaveChartContainer', 
                ChartManager.hasData(joinValues) || ChartManager.hasData(leaveValues));
        },

        /**
         * Update moderation actions chart
         * @private
         */
        _updateModerationChart(data) {
            const chartId = 'moderationChart';
            const chart = ChartRegistry.get(chartId);
            if (!chart) return;
            
            const modActions = data.modActions || {};
            const labels = ['Timeouts', 'Bans', 'Kicks', 'Warns'];
            const values = [
                this._sumCounts(modActions.timeout),
                this._sumCounts(modActions.ban),
                this._sumCounts(modActions.kick),
                this._sumCounts(modActions.warn)
            ];
            
            ChartManager.updateChart(chartId, labels, [values]);
            ChartManager.toggleContainer('moderationChartContainer', ChartManager.hasData(values));
        },

        /**
         * Update spam detection chart
         * @private
         */
        _updateSpamChart(data) {
            if (!data.spam || !Array.isArray(data.spam)) return;
            
            const chartId = 'spamChart';
            const chart = ChartRegistry.get(chartId);
            if (!chart) return;
            
            const labels = data.spam.map(d => this._formatTimestamp(d.timestamp));
            const values = data.spam.map(d => d.count || 0);
            
            ChartManager.updateChart(chartId, labels, [values]);
            ChartManager.toggleContainer('spamChartContainer', ChartManager.hasData(values));
        },

        /**
         * Update threat activity chart
         * @private
         */
        _updateThreatChart(data) {
            // Support both direct threats array and nested threat data
            const threats = data.threats || data.threat?.threats || data.spamDetections || [];
            if (!Array.isArray(threats) || threats.length === 0) return;
            
            const chartId = 'threatChart';
            const chart = ChartRegistry.get(chartId);
            if (!chart) return;
            
            const labels = threats.map((d, i) => d.timestamp ? this._formatTimestamp(d.timestamp) : `Day ${i + 1}`);
            const values = threats.map(d => typeof d === 'number' ? d : (d.count || d || 0));
            
            ChartManager.updateChart(chartId, labels, [values]);
            ChartManager.toggleContainer('threatChartContainer', ChartManager.hasData(values));
        },

        /**
         * Sum counts from array of {timestamp, count} objects
         * @private
         */
        _sumCounts(arr) {
            if (!Array.isArray(arr)) return 0;
            return arr.reduce((sum, d) => sum + (d.count || 0), 0);
        },

        /**
         * Format timestamp for chart labels
         * @private
         */
        _formatTimestamp(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DASHBOARD INTEGRATION - Wrapper for existing dashboard code
    // ═══════════════════════════════════════════════════════════════════════════

    const DashboardCharts = {
        
        // Track if initial load is complete
        _initialLoadComplete: false,
        
        // Loading state
        _isLoading: false,

        /**
         * Initialize all dashboard charts with live data
         * This replaces the old initializeCharts function
         */
        async initialize() {
            if (this._isLoading) {
                console.log('[DashboardCharts] Already loading, skipping...');
                return;
            }
            
            this._isLoading = true;
            
            try {
                // Wait for Chart.js
                if (typeof Chart === 'undefined') {
                    console.warn('[DashboardCharts] Chart.js not loaded');
                    return;
                }

                // Get guild ID
                const guildId = this._getGuildId();
                if (!guildId) {
                    console.warn('[DashboardCharts] No guild selected');
                    return;
                }

                console.log('[DashboardCharts] Fetching live analytics for guild:', guildId);
                
                // Fetch live data
                const data = await this._fetchLiveData(guildId);
                
                if (!data || !data.hasData) {
                    console.log('[DashboardCharts] No data available');
                    this._hideAllCharts();
                    return;
                }

                // Create or update each chart
                this._initMessageChart(data);
                this._initJoinLeaveChart(data);
                this._initModerationChart(data);
                this._initSpamChart(data);
                this._initThreatChart(data);
                
                // Update summary stats
                if (data.summary) {
                    this._updateSummaryStats(data.summary);
                }

                // Initialize live update handler (only once)
                if (!this._initialLoadComplete) {
                    LiveUpdateHandler.init();
                    this._initialLoadComplete = true;
                }

                console.log('[DashboardCharts] Initialization complete');
                
            } catch (e) {
                console.error('[DashboardCharts] Initialization failed:', e);
            } finally {
                this._isLoading = false;
            }
        },

        /**
         * Refresh charts with latest data
         */
        async refresh() {
            await this.initialize();
        },

        /**
         * Fetch live analytics data from API
         * @private
         */
        async _fetchLiveData(guildId) {
            try {
                const endpoint = `/api/analytics/live?guildId=${encodeURIComponent(guildId)}`;
                
                // Use global apiFetch if available
                if (window.apiFetch) {
                    return await window.apiFetch(endpoint);
                }
                
                // Fallback to fetch
                const res = await fetch(endpoint, {
                    credentials: 'include'
                });
                
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (e) {
                console.error('[DashboardCharts] Failed to fetch data:', e.message);
                return null;
            }
        },

        /**
         * Get current guild ID
         * @private
         */
        _getGuildId() {
            // Try various sources
            if (window.state && window.state.guildId) return window.state.guildId;
            return localStorage.getItem('selectedGuildId');
        },

        /**
         * Hide all chart containers
         * @private
         */
        _hideAllCharts() {
            const containers = [
                'messageChartContainer', 'joinLeaveChartContainer',
                'moderationChartContainer', 'spamChartContainer',
                'threatChartContainer', 'threat-chart-container',
                'join-chart-container', 'automod-chart-container'
            ];
            containers.forEach(id => ChartManager.toggleContainer(id, false));
        },

        // ═══════════════════════════════════════════════════════════════════════
        // CHART INITIALIZERS
        // ═══════════════════════════════════════════════════════════════════════

        _initMessageChart(data) {
            const messages = data.messages || [];
            const labels = messages.map(d => this._formatHour(d.timestamp));
            const values = messages.map(d => d.count || 0);
            
            ChartManager.createOrUpdate('messageChart', {
                canvasId: 'messageChart',
                type: 'line',
                labels: labels,
                datasets: [{
                    label: 'Messages',
                    data: values,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }]
            });
            
            ChartManager.toggleContainer('messageChartContainer', ChartManager.hasData(values));
        },

        _initJoinLeaveChart(data) {
            const joins = data.joins || [];
            const leaves = data.leaves || [];
            const labels = joins.map(d => this._formatHour(d.timestamp));
            
            ChartManager.createOrUpdate('joinLeaveChart', {
                canvasId: 'joinLeaveChart',
                type: 'bar',
                labels: labels,
                datasets: [{
                    label: 'Joins',
                    data: joins.map(d => d.count || 0),
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderRadius: 4
                }, {
                    label: 'Leaves',
                    data: leaves.map(d => d.count || 0),
                    backgroundColor: 'rgba(239, 68, 68, 0.6)',
                    borderRadius: 4
                }]
            });
            
            ChartManager.toggleContainer('joinLeaveChartContainer', 
                joins.length > 0 || leaves.length > 0);
        },

        _initModerationChart(data) {
            const modActions = data.modActions || {};
            const labels = ['Timeouts', 'Bans', 'Kicks', 'Warns'];
            const values = [
                this._sumArray(modActions.timeout),
                this._sumArray(modActions.ban),
                this._sumArray(modActions.kick),
                this._sumArray(modActions.warn)
            ];
            
            ChartManager.createOrUpdate('moderationChart', {
                canvasId: 'moderationChart',
                type: 'bar',
                labels: labels,
                datasets: [{
                    label: 'Actions',
                    data: values,
                    backgroundColor: [
                        'rgba(168, 85, 247, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(249, 115, 22, 0.8)',
                        'rgba(251, 191, 36, 0.8)'
                    ],
                    borderRadius: 4
                }]
            });
            
            ChartManager.toggleContainer('moderationChartContainer', ChartManager.hasData(values));
        },

        _initSpamChart(data) {
            const spam = data.spam || [];
            const labels = spam.map(d => this._formatHour(d.timestamp));
            const values = spam.map(d => d.count || 0);
            
            ChartManager.createOrUpdate('spamChart', {
                canvasId: 'spamChart',
                type: 'line',
                labels: labels,
                datasets: [{
                    label: 'Spam Detected',
                    data: values,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            });
            
            ChartManager.toggleContainer('spamChartContainer', ChartManager.hasData(values));
        },

        _initThreatChart(data) {
            // Also handle legacy chart-fix.js format
            const spam = data.spam || data.threats || [];
            const labels = spam.map(d => this._formatHour(d.timestamp));
            const values = spam.map(d => d.count || 0);
            
            ChartManager.createOrUpdate('threatChart', {
                canvasId: 'threatChart',
                type: 'line',
                labels: labels,
                datasets: [{
                    label: 'Threats Detected',
                    data: values,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }]
            });
            
            ChartManager.toggleContainer('threatChartContainer', ChartManager.hasData(values));
            ChartManager.toggleContainer('threat-chart-container', ChartManager.hasData(values));
        },

        // ═══════════════════════════════════════════════════════════════════════
        // HELPERS
        // ═══════════════════════════════════════════════════════════════════════

        _formatHour(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },

        _sumArray(arr) {
            if (!Array.isArray(arr)) return 0;
            return arr.reduce((sum, d) => sum + (d.count || 0), 0);
        },

        _updateSummaryStats(summary) {
            // Update any summary stat elements in the DOM
            const mappings = {
                'totalMessages': ['messages-24h', 'stat-messages'],
                'totalJoins': ['joins-24h', 'stat-joins'],
                'totalLeaves': ['leaves-24h', 'stat-leaves'],
                'totalTimeouts': ['timeouts-24h', 'stat-timeouts'],
                'totalBans': ['bans-24h', 'stat-bans'],
                'totalKicks': ['kicks-24h', 'stat-kicks'],
                'totalSpamEvents': ['spam-24h', 'stat-spam']
            };

            for (const [key, ids] of Object.entries(mappings)) {
                if (summary[key] !== undefined) {
                    ids.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.textContent = summary[key].toLocaleString();
                    });
                }
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOBAL EXPORTS & COMPATIBILITY LAYER
    // ═══════════════════════════════════════════════════════════════════════════

    // Export for global access
    window.ChartRegistry = ChartRegistry;
    window.ChartManager = ChartManager;
    window.DashboardCharts = DashboardCharts;
    window.LiveUpdateHandler = LiveUpdateHandler;

    // Legacy compatibility - replace old functions
    window.initializeCharts = () => DashboardCharts.initialize();
    window.refreshCharts = () => DashboardCharts.refresh();
    window.fixCharts = () => DashboardCharts.initialize();
    window.initChartsOnce = () => DashboardCharts.initialize();

    // Expose utility for external use
    window.updateChart = (chartId, labels, datasets) => ChartManager.updateChart(chartId, labels, datasets);

    // Store charts in window.charts for backward compatibility
    window.charts = new Proxy({}, {
        get(target, prop) {
            return ChartRegistry.get(prop);
        },
        set(target, prop, value) {
            ChartRegistry.set(prop, value);
            return true;
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP ON PAGE UNLOAD
    // ═══════════════════════════════════════════════════════════════════════════

    window.addEventListener('beforeunload', () => {
        ChartRegistry.destroyAll();
    });

    // Re-initialize when guild changes
    window.addEventListener('guildChanged', () => {
        console.log('[ChartManager] Guild changed, refreshing...');
        DashboardCharts.refresh();
    });

    console.log('[ChartManager] v2.0.0 loaded');

})();
