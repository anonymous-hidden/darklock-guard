/**
 * AutoMod & XP Settings - Interactive Logic
 * Handles all client-side functionality for the automod settings page
 */

// State management
const AutoModState = {
    modules: {
        wordFilter: { enabled: false, words: [], regex: [], action: 'delete' },
        capsFilter: { enabled: false, maxPercent: 80, minLength: 10, action: 'delete' },
        emojiSpam: { enabled: false, maxEmojis: 15, maxStickers: 3, action: 'delete' },
        mentionSpam: { enabled: false, maxMentions: 5, maxRolePings: 2, action: 'timeout' },
        inviteFilter: { enabled: false, allowOwn: true, whitelist: [], action: 'delete' },
        lengthFilter: { enabled: false, minLength: 0, maxLength: 2000, action: 'delete' }
    },
    xp: {
        enabled: false,
        xpPerMessage: { min: 15, max: 25 },
        cooldown: 60,
        voiceXp: 10,
        levelUpChannel: '',
        levelUpMessage: 'Congratulations {user}! You\'ve reached **Level {level}**!',
        noXpChannels: [],
        noXpRoles: [],
        multiplierRoles: []
    },
    isDirty: false,
    guildId: null
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initAutoMod();
});

/**
 * Initialize the AutoMod page
 */
async function initAutoMod() {
    // Get guild ID from URL or state
    const urlParams = new URLSearchParams(window.location.search);
    AutoModState.guildId = urlParams.get('guild') || window.selectedGuildId || localStorage.getItem('selectedGuildId');

    if (!AutoModState.guildId) {
        showNotification('Please select a server first', 'error');
        return;
    }

    // Load settings from server
    await loadSettings();

    // Setup event listeners
    setupEventListeners();

    // Update UI to reflect loaded state
    updateAllModuleStates();
}

/**
 * Load settings from the server
 */
async function loadSettings() {
    try {
        const response = await SecureAuth.fetch(`/api/automod/settings?guildId=${AutoModState.guildId}`);
        
        if (response.success && response.settings) {
            // Merge with defaults
            Object.assign(AutoModState.modules, response.settings.modules || {});
            Object.assign(AutoModState.xp, response.settings.xp || {});
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
        // Use defaults on error
    }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Module toggles
    document.querySelectorAll('.module-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const moduleId = e.target.dataset.module;
            toggleModule(moduleId, e.target.checked);
        });
    });

    // Quick settings inputs
    document.querySelectorAll('.quick-setting input, .quick-setting select').forEach(input => {
        input.addEventListener('change', (e) => {
            handleQuickSettingChange(e.target);
        });
    });

    // XP toggle
    const xpToggle = document.getElementById('xp-toggle');
    if (xpToggle) {
        xpToggle.addEventListener('change', (e) => {
            AutoModState.xp.enabled = e.target.checked;
            markDirty();
            updateXPSectionState();
        });
    }

    // Range sliders
    document.querySelectorAll('.range-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const valueDisplay = e.target.nextElementSibling;
            if (valueDisplay && valueDisplay.classList.contains('range-value')) {
                valueDisplay.textContent = e.target.value;
            }
            handleRangeChange(e.target);
        });
    });

    // XP settings
    document.querySelectorAll('.xp-setting input, .xp-setting select, .xp-setting textarea').forEach(input => {
        input.addEventListener('change', (e) => {
            handleXPSettingChange(e.target);
        });
    });

    // Advanced buttons
    document.querySelectorAll('.btn-advanced').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const moduleId = e.target.closest('.module-card')?.dataset.module;
            if (moduleId) {
                openAdvancedModal(moduleId);
            }
        });
    });

    // XP Advanced button
    const xpAdvancedBtn = document.getElementById('xp-advanced-btn');
    if (xpAdvancedBtn) {
        xpAdvancedBtn.addEventListener('click', () => {
            openAdvancedModal('xp');
        });
    }

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // Modal overlay click to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });
    });

    // Save button
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveAllSettings);
    }

    // Reset button
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetToDefaults);
    }

    // Variable tags click to insert
    document.querySelectorAll('.variable-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            const variable = e.target.textContent;
            const textarea = document.getElementById('xp-levelup-message');
            if (textarea) {
                insertAtCursor(textarea, variable);
            }
        });
    });

    // Keyboard shortcut to save (Ctrl+S)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveAllSettings();
        }
    });

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (AutoModState.isDirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

/**
 * Toggle a module on/off
 */
function toggleModule(moduleId, enabled) {
    if (AutoModState.modules[moduleId]) {
        AutoModState.modules[moduleId].enabled = enabled;
        
        // Update card visual state
        const card = document.querySelector(`.module-card[data-module="${moduleId}"]`);
        if (card) {
            card.classList.toggle('active', enabled);
        }
        
        markDirty();
    }
}

/**
 * Handle quick setting change
 */
function handleQuickSettingChange(input) {
    const moduleId = input.closest('.module-card')?.dataset.module;
    const settingKey = input.dataset.setting;
    
    if (moduleId && settingKey && AutoModState.modules[moduleId]) {
        let value = input.type === 'number' ? parseInt(input.value) : input.value;
        AutoModState.modules[moduleId][settingKey] = value;
        markDirty();
    }
}

/**
 * Handle range slider change
 */
function handleRangeChange(slider) {
    const settingPath = slider.dataset.setting;
    if (!settingPath) return;

    const [section, ...keys] = settingPath.split('.');
    let target = section === 'xp' ? AutoModState.xp : AutoModState.modules[section];
    
    if (target) {
        // Navigate to nested property
        for (let i = 0; i < keys.length - 1; i++) {
            target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = parseInt(slider.value);
        markDirty();
    }
}

/**
 * Handle XP setting change
 */
function handleXPSettingChange(input) {
    const settingKey = input.dataset.setting;
    if (!settingKey) return;

    let value;
    if (input.type === 'number') {
        value = parseInt(input.value);
    } else if (input.type === 'checkbox') {
        value = input.checked;
    } else {
        value = input.value;
    }

    // Handle nested keys like xpPerMessage.min
    const keys = settingKey.split('.');
    let target = AutoModState.xp;
    for (let i = 0; i < keys.length - 1; i++) {
        target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    
    markDirty();
}

/**
 * Open advanced settings modal for a module
 */
function openAdvancedModal(moduleId) {
    const modal = document.getElementById(`modal-${moduleId}`);
    if (modal) {
        // Populate modal with current values
        populateModal(moduleId);
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Close any open modal
 */
function closeModal() {
    document.querySelectorAll('.modal-overlay.active').forEach(modal => {
        modal.classList.remove('active');
    });
    document.body.style.overflow = '';
}

/**
 * Populate modal fields with current state
 */
function populateModal(moduleId) {
    if (moduleId === 'xp') {
        // XP modal fields
        const noXpChannels = document.getElementById('xp-no-channels');
        if (noXpChannels) {
            renderTags(noXpChannels, AutoModState.xp.noXpChannels, 'channel');
        }
        
        const noXpRoles = document.getElementById('xp-no-roles');
        if (noXpRoles) {
            renderTags(noXpRoles, AutoModState.xp.noXpRoles, 'role');
        }
    } else if (moduleId === 'wordFilter') {
        // Word filter modal
        const wordList = document.getElementById('word-filter-list');
        if (wordList) {
            renderTags(wordList, AutoModState.modules.wordFilter.words, 'word');
        }
        
        const regexList = document.getElementById('word-filter-regex');
        if (regexList) {
            renderTags(regexList, AutoModState.modules.wordFilter.regex, 'regex');
        }
        
        // Set action selector
        const actionSelector = document.querySelector(`#modal-wordFilter .severity-option[data-action="${AutoModState.modules.wordFilter.action}"]`);
        if (actionSelector) {
            document.querySelectorAll('#modal-wordFilter .severity-option').forEach(opt => opt.classList.remove('selected'));
            actionSelector.classList.add('selected');
        }
    }
    // Add more module-specific population as needed
}

/**
 * Render tags in a tag container
 */
function renderTags(container, items, type) {
    const existingTags = container.querySelectorAll('.tag-item');
    existingTags.forEach(tag => tag.remove());
    
    const input = container.querySelector('.tag-input');
    
    items.forEach(item => {
        const tag = document.createElement('span');
        tag.className = 'tag-item';
        tag.innerHTML = `
            ${type === 'channel' ? '#' : type === 'role' ? '@' : ''}${item.name || item}
            <span class="tag-remove" data-id="${item.id || item}"><i class="fas fa-times"></i></span>
        `;
        container.insertBefore(tag, input);
    });
}

/**
 * Save modal settings
 */
function saveModalSettings(moduleId) {
    // Collect all settings from the modal
    const modal = document.getElementById(`modal-${moduleId}`);
    if (!modal) return;

    if (moduleId === 'wordFilter') {
        // Get selected action
        const selectedAction = modal.querySelector('.severity-option.selected');
        if (selectedAction) {
            AutoModState.modules.wordFilter.action = selectedAction.dataset.action;
        }
    }

    // Close modal and mark dirty
    closeModal();
    markDirty();
    showNotification('Settings updated. Don\'t forget to save!', 'success');
}

/**
 * Update all module visual states
 */
function updateAllModuleStates() {
    // Update module cards
    Object.entries(AutoModState.modules).forEach(([id, module]) => {
        const card = document.querySelector(`.module-card[data-module="${id}"]`);
        const toggle = document.querySelector(`.module-toggle[data-module="${id}"]`);
        
        if (card) {
            card.classList.toggle('active', module.enabled);
        }
        if (toggle) {
            toggle.checked = module.enabled;
        }

        // Update quick setting values
        Object.entries(module).forEach(([key, value]) => {
            if (key !== 'enabled') {
                const input = document.querySelector(`[data-module="${id}"] [data-setting="${key}"]`);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = value;
                    } else {
                        input.value = value;
                    }
                }
            }
        });
    });

    // Update XP section
    updateXPSectionState();
}

/**
 * Update XP section state
 */
function updateXPSectionState() {
    const xpToggle = document.getElementById('xp-toggle');
    if (xpToggle) {
        xpToggle.checked = AutoModState.xp.enabled;
    }

    // Update XP setting values
    Object.entries(AutoModState.xp).forEach(([key, value]) => {
        if (typeof value !== 'object') {
            const input = document.querySelector(`[data-setting="${key}"]`);
            if (input) {
                input.value = value;
                // Update range display if applicable
                if (input.type === 'range') {
                    const display = input.nextElementSibling;
                    if (display && display.classList.contains('range-value')) {
                        display.textContent = value;
                    }
                }
            }
        }
    });

    // Update min/max XP sliders
    const minXpSlider = document.querySelector('[data-setting="xpPerMessage.min"]');
    const maxXpSlider = document.querySelector('[data-setting="xpPerMessage.max"]');
    if (minXpSlider) {
        minXpSlider.value = AutoModState.xp.xpPerMessage.min;
        const display = minXpSlider.nextElementSibling;
        if (display) display.textContent = AutoModState.xp.xpPerMessage.min;
    }
    if (maxXpSlider) {
        maxXpSlider.value = AutoModState.xp.xpPerMessage.max;
        const display = maxXpSlider.nextElementSibling;
        if (display) display.textContent = AutoModState.xp.xpPerMessage.max;
    }
}

/**
 * Save all settings to server
 */
async function saveAllSettings() {
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
        const response = await SecureAuth.fetch('/api/automod/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guildId: AutoModState.guildId,
                modules: AutoModState.modules,
                xp: AutoModState.xp
            })
        });

        if (response.success) {
            showNotification('Settings saved successfully!', 'success');
            AutoModState.isDirty = false;
        } else {
            throw new Error(response.error || 'Failed to save');
        }
    } catch (error) {
        console.error('Save failed:', error);
        showNotification('Failed to save settings: ' + error.message, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save All';
        }
    }
}

/**
 * Reset all settings to defaults
 */
function resetToDefaults() {
    if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
        return;
    }

    // Reset to default state
    AutoModState.modules = {
        wordFilter: { enabled: false, words: [], regex: [], action: 'delete' },
        capsFilter: { enabled: false, maxPercent: 80, minLength: 10, action: 'delete' },
        emojiSpam: { enabled: false, maxEmojis: 15, maxStickers: 3, action: 'delete' },
        mentionSpam: { enabled: false, maxMentions: 5, maxRolePings: 2, action: 'timeout' },
        inviteFilter: { enabled: false, allowOwn: true, whitelist: [], action: 'delete' },
        lengthFilter: { enabled: false, minLength: 0, maxLength: 2000, action: 'delete' }
    };

    AutoModState.xp = {
        enabled: false,
        xpPerMessage: { min: 15, max: 25 },
        cooldown: 60,
        voiceXp: 10,
        levelUpChannel: '',
        levelUpMessage: 'Congratulations {user}! You\'ve reached **Level {level}**!',
        noXpChannels: [],
        noXpRoles: [],
        multiplierRoles: []
    };

    updateAllModuleStates();
    markDirty();
    showNotification('Settings reset to defaults. Don\'t forget to save!', 'success');
}

/**
 * Mark state as dirty (unsaved changes)
 */
function markDirty() {
    AutoModState.isDirty = true;
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn && !saveBtn.classList.contains('pulse')) {
        saveBtn.classList.add('pulse');
    }
}

/**
 * Show notification toast
 */
function showNotification(message, type = 'success') {
    // Remove existing notifications
    document.querySelectorAll('.notification').forEach(n => n.remove());

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(notification);

    // Show animation
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });

    // Auto hide
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 400);
    }, 4000);
}

/**
 * Insert text at cursor position in textarea
 */
function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    
    textarea.value = before + text + after;
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
    
    // Trigger change event
    textarea.dispatchEvent(new Event('change'));
}

/**
 * Handle tag input (for word lists, channels, etc.)
 */
function setupTagInput(containerId, stateKey, moduleId = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const input = container.querySelector('.tag-input');
    if (!input) return;

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const value = input.value.trim();
            if (value) {
                addTag(container, value, stateKey, moduleId);
                input.value = '';
            }
        }
    });
}

/**
 * Add a tag to a container and state
 */
function addTag(container, value, stateKey, moduleId = null) {
    // Add to state
    const targetArray = moduleId 
        ? AutoModState.modules[moduleId][stateKey]
        : AutoModState.xp[stateKey];
    
    if (!targetArray.includes(value)) {
        targetArray.push(value);
        
        // Add visual tag
        const input = container.querySelector('.tag-input');
        const tag = document.createElement('span');
        tag.className = 'tag-item';
        tag.innerHTML = `
            ${value}
            <span class="tag-remove" data-value="${value}"><i class="fas fa-times"></i></span>
        `;
        
        // Add remove handler
        tag.querySelector('.tag-remove').addEventListener('click', () => {
            const index = targetArray.indexOf(value);
            if (index > -1) {
                targetArray.splice(index, 1);
            }
            tag.remove();
            markDirty();
        });
        
        container.insertBefore(tag, input);
        markDirty();
    }
}

/**
 * Handle severity selector clicks
 */
function setupSeveritySelectors() {
    document.querySelectorAll('.severity-selector').forEach(selector => {
        selector.querySelectorAll('.severity-option').forEach(option => {
            option.addEventListener('click', () => {
                selector.querySelectorAll('.severity-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                option.classList.add('selected');
            });
        });
    });
}

// Initialize severity selectors when DOM is ready
document.addEventListener('DOMContentLoaded', setupSeveritySelectors);

// Export for use in HTML
window.AutoMod = {
    saveModalSettings,
    closeModal,
    addTag,
    showNotification
};
