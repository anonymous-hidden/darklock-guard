/**
 * Chart Manager - Production-ready Chart.js integration
 * 
 * Features:
 * - Unified chart management (no global pollution)
 * - WebSocket live updates via "analytics_update" event
 * - Auto-hide containers when no data available
 * - Memory cleanup (destroy old charts before recreating)
 * - Graceful error handling (no console errors on empty data)
 * - Compatible with Chart.js v3+
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CHART MANAGER - Singleton pattern to avoid global variable issues
    // ═══════════════════════════════════════════════════════════════════════════

    const ChartManager = {
        // Chart instances
        instances: {
            threat: null,
            join: null,
            autoMod: null
        },

        // Container IDs mapped to chart keys
        containerMap: {
            threat: 'threat-chart-container',
            join: 'join-chart-container',
            autoMod: 'automod-chart-container'
        },

        // Canvas IDs
        canvasMap: {
            threat: 'threatChart',
            join: 'joinChart',
            autoMod: 'autoModChart'
        },

        // Current data state
        currentData: null,

        // Initialization flag
        initialized: false,

        // WebSocket reference
        wsListenerAttached: false,

        // ═══════════════════════════════════════════════════════════════════════
        // UTILITY FUNCTIONS
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Check if a dataset has any meaningful data
         * @param {Array|Object} dataset - The data to check
         * @returns {boolean} - True if data exists and has values > 0
         */
        hasData(dataset) {
            if (!dataset) return false;
            
            if (Array.isArray(dataset)) {
                return dataset.some(val => val > 0);
            }
            
            if (typeof dataset === 'object') {
                return Object.values(dataset).some(val => typeof val === 'number' && val > 0);
            }
            
            return false;
        },

        /**
         * Hide chart container if no data, show if data exists
         * @param {string} containerId - The container element ID
         * @param {Array|Object} dataset - The dataset to check
         */
        hideChartIfNoData(containerId, dataset) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const hasValidData = this.hasData(dataset);
            
            if (hasValidData) {
                container.style.display = '';
                container.classList.remove('chart-hidden');
                container.classList.add('chart-visible');
            } else {
                container.style.display = 'none';
                container.classList.remove('chart-visible');
                container.classList.add('chart-hidden');
            }
        },

        /**
         * Update an existing chart with new data
         * @param {Chart} chart - The Chart.js instance
         * @param {Array} newData - New dataset values
         * @param {Object} options - Optional update options
         */
        updateChart(chart, newData, options = {}) {
            if (!chart) return;

            try {
                // Handle empty data - clear the chart
                if (!newData || (Array.isArray(newData) && newData.length === 0)) {
                    chart.data.datasets.forEach(dataset => {
                        dataset.data = [];
                    });
                } else {
                    // Update with new data
                    chart.data.datasets[0].data = newData;
                }

                // Update without animation for smoother live updates
                chart.update(options.animate ? 'default' : 'none');
            } catch (error) {
                console.warn('[ChartManager] Failed to update chart:', error.message);
            }
        },

        /**
         * Safely destroy a chart instance
         * @param {string} key - The chart key (threat, join, autoMod)
         */
        destroyChart(key) {
            if (this.instances[key]) {
                try {
                    this.instances[key].destroy();
                } catch (e) {
                    // Chart already destroyed or invalid
                }
                this.instances[key] = null;
            }
        },

        /**
         * Destroy all chart instances (cleanup)
         */
        destroyAll() {
            Object.keys(this.instances).forEach(key => this.destroyChart(key));
        },

        // ═══════════════════════════════════════════════════════════════════════
        // CHART CREATION
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Create the Threat Activity line chart
         * @param {Object} data - Threat data with timestamps and values
         */
        createThreatChart(data) {
            const canvasId = this.canvasMap.threat;
            const containerId = this.containerMap.threat;
            const canvas = document.getElementById(canvasId);
            
            if (!canvas) {
                console.warn(`[ChartManager] Canvas #${canvasId} not found`);
                return;
            }

            // Prepare data
            const timestamps = data?.timestamps || this.generateTimeLabels(7);
            const values = data?.threats || data?.spamDetections || Array(7).fill(0);

            // Always show chart container
            const container = document.getElementById(containerId);
            if (container) {
                container.style.display = '';
                container.classList.remove('chart-hidden');
                container.classList.add('chart-visible');
            }

            // Destroy existing chart
            this.destroyChart('threat');

            // Create new chart
            try {
                this.instances.threat = new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: timestamps,
                        datasets: [{
                            label: 'Threats Detected',
                            data: values,
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            pointBackgroundColor: '#ef4444'
                        }]
                    },
                    options: this.getLineChartOptions('Threats')
                });
            } catch (error) {
                console.error('[ChartManager] Failed to create threat chart:', error);
            }
        },

        /**
         * Create the Member Growth bar chart
         * @param {Object} data - Join/leave data
         */
        createJoinChart(data) {
            const canvasId = this.canvasMap.join;
            const containerId = this.containerMap.join;
            const canvas = document.getElementById(canvasId);
            
            if (!canvas) {
                console.warn(`[ChartManager] Canvas #${canvasId} not found`);
                return;
            }

            // Prepare data
            const labels = data?.labels || ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
            const joins = data?.joins || Array(4).fill(0);
            const leaves = data?.leaves || Array(4).fill(0);

            // Always show chart container
            const container = document.getElementById(containerId);
            if (container) {
                container.style.display = '';
                container.classList.remove('chart-hidden');
                container.classList.add('chart-visible');
            }

            // Destroy existing chart
            this.destroyChart('join');

            // Create new chart
            try {
                this.instances.join = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Joins',
                            data: joins,
                            backgroundColor: 'rgba(16, 185, 129, 0.8)',
                            borderRadius: 4,
                            maxBarThickness: 50
                        }, {
                            label: 'Leaves',
                            data: leaves,
                            backgroundColor: 'rgba(239, 68, 68, 0.6)',
                            borderRadius: 4,
                            maxBarThickness: 50
                        }]
                    },
                    options: this.getBarChartOptions('Members')
                });
            } catch (error) {
                console.error('[ChartManager] Failed to create join chart:', error);
            }
        },

        /**
         * Create the AutoMod Actions bar chart
         * @param {Object} data - AutoMod action counts
         */
        createAutoModChart(data) {
            const canvasId = this.canvasMap.autoMod;
            const containerId = this.containerMap.autoMod;
            const canvas = document.getElementById(canvasId);
            
            if (!canvas) {
                console.warn(`[ChartManager] Canvas #${canvasId} not found`);
                return;
            }

            // Prepare data - handle both array and object formats
            let values, labels;
            if (Array.isArray(data)) {
                values = data;
                labels = ['Warns', 'Mutes', 'Kicks', 'Bans', 'Deletes'];
            } else if (data && typeof data === 'object') {
                values = [
                    data.warnings || 0,
                    data.mutes || 0,
                    data.kicks || 0,
                    data.bans || 0,
                    data.deletions || 0
                ];
                labels = ['Warns', 'Mutes', 'Kicks', 'Bans', 'Deletes'];
            } else {
                values = Array(5).fill(0);
                labels = ['Warns', 'Mutes', 'Kicks', 'Bans', 'Deletes'];
            }

            // Always show chart container
            const container = document.getElementById(containerId);
            if (container) {
                container.style.display = '';
                container.classList.remove('chart-hidden');
                container.classList.add('chart-visible');
            }

            // Destroy existing chart
            this.destroyChart('autoMod');

            // Create new chart
            try {
                this.instances.autoMod = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Actions',
                            data: values,
                            backgroundColor: [
                                'rgba(251, 191, 36, 0.8)',  // Warns - amber
                                'rgba(168, 85, 247, 0.8)',  // Mutes - purple
                                'rgba(249, 115, 22, 0.8)',  // Kicks - orange
                                'rgba(239, 68, 68, 0.8)',   // Bans - red
                                'rgba(59, 130, 246, 0.8)'   // Deletes - blue
                            ],
                            borderRadius: 4,
                            maxBarThickness: 50
                        }]
                    },
                    options: this.getBarChartOptions('Actions')
                });
            } catch (error) {
                console.error('[ChartManager] Failed to create automod chart:', error);
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        // CHART OPTIONS TEMPLATES
        // ═══════════════════════════════════════════════════════════════════════

        getLineChartOptions(yAxisLabel) {
            return {
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
                        padding: 12,
                        displayColors: false
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
                        beginAtZero: true,
                        title: { display: false }
                    }
                }
            };
        },

        getBarChartOptions(yAxisLabel) {
            return {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
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
                        grid: { display: false },
                        ticks: { color: '#64748b', font: { size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(148, 163, 184, 0.1)', drawBorder: false },
                        ticks: { color: '#64748b', font: { size: 11 }, stepSize: 1 },
                        beginAtZero: true
                    }
                }
            };
        },

        // ═══════════════════════════════════════════════════════════════════════
        // DATA LOADING
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Generate time labels for the past N days
         * @param {number} days - Number of days
         * @returns {Array} - Array of day labels
         */
        generateTimeLabels(days) {
            const labels = [];
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const today = new Date();
            
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                labels.push(dayNames[date.getDay()]);
            }
            
            return labels;
        },

        /**
         * Fetch analytics data from API
         * @returns {Promise<Object>} - Analytics data
         */
        async fetchAnalytics() {
            try {
                const guildId = localStorage.getItem('selectedGuildId');
                if (!guildId) {
                    console.warn('[ChartManager] No guild selected');
                    return null;
                }

                const endpoint = `/api/analytics?guildId=${encodeURIComponent(guildId)}`;
                
                // Use global apiFetch if available (handles auth)
                let response;
                if (window.apiFetch) {
                    response = await window.apiFetch(endpoint);
                } else {
                    const res = await fetch(endpoint, {
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    response = await res.json();
                }

                return response;
            } catch (error) {
                console.warn('[ChartManager] Failed to fetch analytics:', error.message);
                return null;
            }
        },

        /**
         * Transform raw API/WebSocket data into chart-ready format
         * @param {Object} rawData - Raw analytics data
         * @returns {Object} - Formatted chart data
         */
        transformData(rawData) {
            if (!rawData) return null;

            // Handle WebSocket format: { timestamps, messages, joins, leaves, spamDetections }
            if (rawData.timestamps) {
                return {
                    threat: {
                        timestamps: rawData.timestamps,
                        threats: rawData.spamDetections || rawData.threats || []
                    },
                    join: {
                        labels: rawData.timestamps,
                        joins: rawData.joins || [],
                        leaves: rawData.leaves || []
                    },
                    autoMod: rawData.autoMod || {
                        warnings: 0,
                        mutes: 0,
                        kicks: 0,
                        bans: 0,
                        deletions: 0
                    }
                };
            }

            // Handle API format
            return {
                threat: {
                    timestamps: this.generateTimeLabels(7),
                    threats: rawData.threatActivity || rawData.threats || []
                },
                join: {
                    labels: rawData.memberLabels || ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
                    joins: rawData.joins || rawData.memberJoins || [],
                    leaves: rawData.leaves || rawData.memberLeaves || []
                },
                autoMod: rawData.autoMod || rawData.modActions || {
                    warnings: rawData.warnings || 0,
                    mutes: rawData.mutes || 0,
                    kicks: rawData.kicks || 0,
                    bans: rawData.bans || 0,
                    deletions: rawData.deletions || 0
                }
            };
        },

        // ═══════════════════════════════════════════════════════════════════════
        // LIVE UPDATES
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Handle incoming analytics update from WebSocket
         * @param {Object} data - The analytics_update payload
         */
        handleAnalyticsUpdate(data) {
            console.log('[ChartManager] Received live analytics update');
            
            const chartData = this.transformData(data);
            if (!chartData) return;

            this.currentData = chartData;
            this.renderAllCharts(chartData);
        },

        /**
         * Attach WebSocket listener for analytics_update events
         */
        attachWebSocketListener() {
            if (this.wsListenerAttached) return;

            // Listen for custom event dispatched by dashboard-pro.js
            window.addEventListener('analytics_update', (event) => {
                this.handleAnalyticsUpdate(event.detail);
            });

            // Also hook into global WebSocket message handler if available
            const originalHandler = window.handleWebSocketMessage;
            window.handleWebSocketMessage = (data) => {
                if (originalHandler) originalHandler(data);
                
                if (data.type === 'analytics_update' && data.data) {
                    this.handleAnalyticsUpdate(data.data);
                }
            };

            this.wsListenerAttached = true;
            console.log('[ChartManager] WebSocket listener attached');
        },

        // ═══════════════════════════════════════════════════════════════════════
        // RENDERING
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Render all charts with provided data
         * @param {Object} data - Transformed chart data
         */
        renderAllCharts(data) {
            if (!data) {
                this.hideAllCharts();
                return;
            }

            this.createThreatChart(data.threat);
            this.createJoinChart(data.join);
            this.createAutoModChart(data.autoMod);
        },

        /**
         * Hide all chart containers (no data state)
         */
        hideAllCharts() {
            Object.keys(this.containerMap).forEach(key => {
                const container = document.getElementById(this.containerMap[key]);
                if (container) {
                    container.style.display = 'none';
                    container.classList.add('chart-hidden');
                }
            });
        },

        /**
         * Show all chart containers
         */
        showAllCharts() {
            Object.keys(this.containerMap).forEach(key => {
                const container = document.getElementById(this.containerMap[key]);
                if (container) {
                    container.style.display = '';
                    container.classList.remove('chart-hidden');
                }
            });
        },

        // ═══════════════════════════════════════════════════════════════════════
        // INITIALIZATION
        // ═══════════════════════════════════════════════════════════════════════

        /**
         * Initialize the chart system
         */
        async init() {
            if (this.initialized) {
                console.log('[ChartManager] Already initialized');
                return;
            }

            console.log('[ChartManager] Initializing...');

            // Check for Chart.js
            if (typeof Chart === 'undefined') {
                console.error('[ChartManager] Chart.js not loaded');
                return;
            }

            // Attach WebSocket listener
            this.attachWebSocketListener();

            // Fetch initial data
            const rawData = await this.fetchAnalytics();
            const chartData = this.transformData(rawData);

            // Always render charts (with empty data if needed)
            if (chartData) {
                this.currentData = chartData;
            } else {
                // Use empty data structure
                this.currentData = {
                    threat: { timestamps: this.generateTimeLabels(7), threats: Array(7).fill(0) },
                    join: { labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'], joins: Array(4).fill(0), leaves: Array(4).fill(0) },
                    autoMod: { warnings: 0, mutes: 0, kicks: 0, bans: 0, deletions: 0 }
                };
            }
            
            this.renderAllCharts(this.currentData);

            this.initialized = true;
            console.log('[ChartManager] Initialization complete');
        },

        /**
         * Refresh charts with latest data
         */
        async refresh() {
            const rawData = await this.fetchAnalytics();
            const chartData = this.transformData(rawData);

            if (chartData) {
                this.currentData = chartData;
            } else {
                // Use empty data if API fails
                this.currentData = {
                    threat: { timestamps: this.generateTimeLabels(7), threats: Array(7).fill(0) },
                    join: { labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'], joins: Array(4).fill(0), leaves: Array(4).fill(0) },
                    autoMod: { warnings: 0, mutes: 0, kicks: 0, bans: 0, deletions: 0 }
                };
            }
            
            this.renderAllCharts(this.currentData);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOBAL EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    // Expose ChartManager globally
    window.ChartManager = ChartManager;

    // Legacy compatibility - expose fixCharts function
    window.fixCharts = () => ChartManager.init();
    window.refreshCharts = () => ChartManager.refresh();
    window.initChartsOnce = () => ChartManager.init();

    // Standalone utility functions for external use
    window.updateChart = (chart, newData, options) => ChartManager.updateChart(chart, newData, options);
    window.hideChartIfNoData = (containerId, dataset) => ChartManager.hideChartIfNoData(containerId, dataset);

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-INITIALIZATION (DISABLED - dashboard-pro.js owns chart lifecycle)
    // ═══════════════════════════════════════════════════════════════════════════

    // NOTE: We no longer auto-init here because dashboard-pro.js
    // controls when analytics charts are created. Auto-init can
    // conflict with its own initializeCharts() flow and cause
    // "Canvas is already in use" errors.

    // If needed in the future, explicitly call window.fixCharts()
    // or ChartManager.init() from the dashboard code instead of
    // relying on this file to auto-start.

    // Re-initialize when guild selection changes
    window.addEventListener('guildChanged', () => {
        console.log('[ChartManager] Guild changed, refreshing charts');
        ChartManager.refresh();
    });

})();
