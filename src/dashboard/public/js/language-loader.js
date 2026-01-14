/**
 * Dashboard Language Loader
 * Automatically loads and applies the guild's language preference
 */

const TRANSLATIONS = {
    en: {
        // Navigation
        'nav.dashboard': 'Dashboard',
        'nav.setup': 'Setup',
        'nav.moderation': 'Moderation',
        'nav.logs': 'Logs',
        'nav.analytics': 'Analytics',
        'nav.settings': 'Settings',
        
        // Common
        'common.save': 'Save Settings',
        'common.saveAll': 'Save All Settings',
        'common.cancel': 'Cancel',
        'common.confirm': 'Confirm',
        'common.loading': 'Loading...',
        'common.success': 'Success',
        'common.error': 'Error',
        'common.enabled': 'Enabled',
        'common.disabled': 'Disabled',
        'common.enable': 'Enable',
        'common.disable': 'Disable',
        'common.status': 'Status',
        'common.actions': 'Actions',
        
        // Dashboard
        'dashboard.welcome': 'Welcome to',
        'dashboard.selectServer': 'Select a server to get started',
        
        // Setup Pages
        'setup.antiSpam.title': 'Anti-Spam Protection',
        'setup.antiSpam.desc': 'Configure spam detection and prevention',
        'setup.antiLinks.title': 'Anti-Links Protection',
        'setup.antiLinks.desc': 'Control link sharing in your server',
        'setup.antiPhishing.title': 'Anti-Phishing Protection',
        'setup.antiPhishing.desc': 'Protect against malicious links',
        'setup.moderation.title': 'Moderation Settings',
        'setup.moderation.desc': 'Configure moderation tools and logging',
        
        // Settings
        'settings.saved': 'Settings saved successfully',
        'settings.failed': 'Failed to save settings',
        'settings.loading': 'Loading settings...',
    },
    
    de: {
        // Navigation
        'nav.dashboard': 'Dashboard',
        'nav.setup': 'Einstellungen',
        'nav.moderation': 'Moderation',
        'nav.logs': 'Protokolle',
        'nav.analytics': 'Analytik',
        'nav.settings': 'Einstellungen',
        
        // Common
        'common.save': 'Einstellungen Speichern',
        'common.saveAll': 'Alle Einstellungen Speichern',
        'common.cancel': 'Abbrechen',
        'common.confirm': 'Bestätigen',
        'common.loading': 'Laden...',
        'common.success': 'Erfolg',
        'common.error': 'Fehler',
        'common.enabled': 'Aktiviert',
        'common.disabled': 'Deaktiviert',
        'common.enable': 'Aktivieren',
        'common.disable': 'Deaktivieren',
        'common.status': 'Status',
        'common.actions': 'Aktionen',
        
        // Dashboard
        'dashboard.welcome': 'Willkommen bei',
        'dashboard.selectServer': 'Wähle einen Server aus, um zu beginnen',
        
        // Setup Pages
        'setup.antiSpam.title': 'Anti-Spam-Schutz',
        'setup.antiSpam.desc': 'Spam-Erkennung und -Prävention konfigurieren',
        'setup.antiLinks.title': 'Anti-Link-Schutz',
        'setup.antiLinks.desc': 'Link-Sharing auf deinem Server kontrollieren',
        'setup.antiPhishing.title': 'Anti-Phishing-Schutz',
        'setup.antiPhishing.desc': 'Schutz vor schädlichen Links',
        'setup.moderation.title': 'Moderationseinstellungen',
        'setup.moderation.desc': 'Moderationswerkzeuge und Protokollierung konfigurieren',
        
        // Settings
        'settings.saved': 'Einstellungen erfolgreich gespeichert',
        'settings.failed': 'Fehler beim Speichern der Einstellungen',
        'settings.loading': 'Einstellungen werden geladen...',
    },
    
    es: {
        // Navigation
        'nav.dashboard': 'Panel',
        'nav.setup': 'Configuración',
        'nav.moderation': 'Moderación',
        'nav.logs': 'Registros',
        'nav.analytics': 'Analíticas',
        'nav.settings': 'Ajustes',
        
        // Common
        'common.save': 'Guardar Configuración',
        'common.cancel': 'Cancelar',
        'common.confirm': 'Confirmar',
        'common.loading': 'Cargando...',
        'common.success': 'Éxito',
        'common.error': 'Error',
        'common.enabled': 'Activado',
        'common.disabled': 'Desactivado',
        
        // Dashboard
        'dashboard.welcome': 'Bienvenido a',
        'dashboard.selectServer': 'Selecciona un servidor para comenzar',
        
        // Settings
        'settings.saved': 'Configuración guardada exitosamente',
        'settings.failed': 'Error al guardar la configuración',
        'settings.loading': 'Cargando configuración...',
    },
    
    fr: {
        // Navigation
        'nav.dashboard': 'Tableau de bord',
        'nav.setup': 'Configuration',
        'nav.moderation': 'Modération',
        'nav.logs': 'Journaux',
        'nav.analytics': 'Analytiques',
        'nav.settings': 'Paramètres',
        
        // Common
        'common.save': 'Enregistrer les Paramètres',
        'common.cancel': 'Annuler',
        'common.confirm': 'Confirmer',
        'common.loading': 'Chargement...',
        'common.success': 'Succès',
        'common.error': 'Erreur',
        'common.enabled': 'Activé',
        'common.disabled': 'Désactivé',
        
        // Dashboard
        'dashboard.welcome': 'Bienvenue sur',
        'dashboard.selectServer': 'Sélectionnez un serveur pour commencer',
        
        // Settings
        'settings.saved': 'Paramètres enregistrés avec succès',
        'settings.failed': 'Échec de l\'enregistrement des paramètres',
        'settings.loading': 'Chargement des paramètres...',
    },
    
    pt: {
        // Navigation
        'nav.dashboard': 'Painel',
        'nav.setup': 'Configuração',
        'nav.moderation': 'Moderação',
        'nav.logs': 'Registros',
        'nav.analytics': 'Análises',
        'nav.settings': 'Configurações',
        
        // Common
        'common.save': 'Salvar Configurações',
        'common.cancel': 'Cancelar',
        'common.confirm': 'Confirmar',
        'common.loading': 'Carregando...',
        'common.success': 'Sucesso',
        'common.error': 'Erro',
        'common.enabled': 'Ativado',
        'common.disabled': 'Desativado',
        
        // Dashboard
        'dashboard.welcome': 'Bem-vindo ao',
        'dashboard.selectServer': 'Selecione um servidor para começar',
        
        // Settings
        'settings.saved': 'Configurações salvas com sucesso',
        'settings.failed': 'Falha ao salvar configurações',
        'settings.loading': 'Carregando configurações...',
    }
};

let currentLanguage = 'en';
let lastLanguageCheck = 0;
const LANGUAGE_CACHE_TTL = 30000; // 30 seconds - refresh language periodically

/**
 * Load guild language preference
 * @param {boolean} forceRefresh - If true, ignore cache and fetch fresh
 */
async function loadGuildLanguage(forceRefresh = false) {
    const guildId = localStorage.getItem('selectedGuildId');
    if (!guildId) {
        currentLanguage = 'en';
        return 'en';
    }
    
    // Use cached value if within TTL and not forcing refresh
    const now = Date.now();
    if (!forceRefresh && (now - lastLanguageCheck) < LANGUAGE_CACHE_TTL) {
        return currentLanguage;
    }
    
    try {
        const response = await fetch(`/api/guild/${guildId}/language`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const newLanguage = data.language || 'en';
            lastLanguageCheck = now;
            
            // If language changed, refresh the page UI
            if (newLanguage !== currentLanguage) {
                console.log(`[Language] Changed from ${currentLanguage} to ${newLanguage}`);
                currentLanguage = newLanguage;
                localStorage.setItem('guildLanguage', currentLanguage);
                applyLanguage();
            }
            
            return currentLanguage;
        }
    } catch (error) {
        console.error('Failed to load guild language:', error);
    }
    
    // Fallback to cached language or English
    currentLanguage = localStorage.getItem('guildLanguage') || 'en';
    return currentLanguage;
}

/**
 * Translate a key to current language
 */
function t(key, fallback) {
    const translations = TRANSLATIONS[currentLanguage] || TRANSLATIONS.en;
    return translations[key] || TRANSLATIONS.en[key] || fallback || key;
}

/**
 * Apply translations to elements with data-i18n attribute
 */
function applyLanguage() {
    // Translate elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = t(key);
        
        if (element.tagName === 'INPUT' && element.placeholder !== undefined) {
            element.placeholder = translation;
        } else {
            element.textContent = translation;
        }
    });
    
    // Update HTML lang attribute
    document.documentElement.lang = currentLanguage;
}

/**
 * Initialize language on page load
 */
if (typeof window !== 'undefined') {
    // Load language when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            loadGuildLanguage(true); // Force refresh on page load
        });
    } else {
        loadGuildLanguage(true); // Force refresh on page load
    }
    
    // Reload language when guild selection changes
    window.addEventListener('storage', (e) => {
        if (e.key === 'selectedGuildId') {
            loadGuildLanguage(true); // Force refresh on guild change
        }
    });
    
    // Periodically check for language changes (every 30 seconds)
    setInterval(() => {
        loadGuildLanguage(false); // Allow cache check
    }, 30000);
    
    // Also refresh when user focuses the window (they might have changed language in Discord)
    window.addEventListener('focus', () => {
        loadGuildLanguage(true); // Force refresh when user returns to dashboard
    });
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { loadGuildLanguage, t, applyLanguage };
}
