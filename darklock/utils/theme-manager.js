const db = require('./database');

const THEMES = {
    // ============================================================================
    // STANDARD THEMES
    // ============================================================================
    darklock: {
        name: 'Darklock',
        description: 'Modern dark theme with cyan accents',
        category: 'standard',
        colors: {
            '--bg-primary': '#0a0a0f',
            '--bg-secondary': '#12121a',
            '--bg-card': 'rgba(255, 255, 255, 0.03)',
            '--bg-card-hover': 'rgba(255, 255, 255, 0.06)',
            '--border-color': 'rgba(255, 255, 255, 0.08)',
            '--border-color-light': 'rgba(255, 255, 255, 0.12)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.7)',
            '--text-muted': 'rgba(255, 255, 255, 0.4)',
            '--accent-primary': '#00f0ff',
            '--accent-secondary': '#7c3aed',
            '--accent-tertiary': '#ec4899',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    midnight: {
        name: 'Midnight Blue',
        description: 'Deep blue theme for night owls',
        category: 'standard',
        colors: {
            '--bg-primary': '#0f1419',
            '--bg-secondary': '#1a1f2e',
            '--bg-card': 'rgba(59, 130, 246, 0.05)',
            '--bg-card-hover': 'rgba(59, 130, 246, 0.1)',
            '--border-color': 'rgba(59, 130, 246, 0.15)',
            '--border-color-light': 'rgba(59, 130, 246, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#3b82f6',
            '--accent-secondary': '#60a5fa',
            '--accent-tertiary': '#a78bfa',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    crimson: {
        name: 'Crimson',
        description: 'Bold red and black theme',
        category: 'standard',
        colors: {
            '--bg-primary': '#0d0a0b',
            '--bg-secondary': '#1a1214',
            '--bg-card': 'rgba(239, 68, 68, 0.05)',
            '--bg-card-hover': 'rgba(239, 68, 68, 0.1)',
            '--border-color': 'rgba(239, 68, 68, 0.15)',
            '--border-color-light': 'rgba(239, 68, 68, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#ef4444',
            '--accent-secondary': '#dc2626',
            '--accent-tertiary': '#f97316',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    emerald: {
        name: 'Emerald',
        description: 'Fresh green nature theme',
        category: 'standard',
        colors: {
            '--bg-primary': '#0a0f0a',
            '--bg-secondary': '#121a12',
            '--bg-card': 'rgba(16, 185, 129, 0.05)',
            '--bg-card-hover': 'rgba(16, 185, 129, 0.1)',
            '--border-color': 'rgba(16, 185, 129, 0.15)',
            '--border-color-light': 'rgba(16, 185, 129, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#10b981',
            '--accent-secondary': '#059669',
            '--accent-tertiary': '#34d399',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    sunset: {
        name: 'Sunset',
        description: 'Warm orange and purple gradient',
        category: 'standard',
        colors: {
            '--bg-primary': '#0f0a0d',
            '--bg-secondary': '#1a1015',
            '--bg-card': 'rgba(249, 115, 22, 0.05)',
            '--bg-card-hover': 'rgba(249, 115, 22, 0.1)',
            '--border-color': 'rgba(249, 115, 22, 0.15)',
            '--border-color-light': 'rgba(168, 85, 247, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#f97316',
            '--accent-secondary': '#a855f7',
            '--accent-tertiary': '#fb923c',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    ocean: {
        name: 'Ocean',
        description: 'Calm teal and aqua theme',
        category: 'standard',
        colors: {
            '--bg-primary': '#0a0f0f',
            '--bg-secondary': '#0f1a1a',
            '--bg-card': 'rgba(20, 184, 166, 0.05)',
            '--bg-card-hover': 'rgba(20, 184, 166, 0.1)',
            '--border-color': 'rgba(20, 184, 166, 0.15)',
            '--border-color-light': 'rgba(20, 184, 166, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#14b8a6',
            '--accent-secondary': '#06b6d4',
            '--accent-tertiary': '#2dd4bf',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    royal: {
        name: 'Royal Purple',
        description: 'Elegant purple theme',
        category: 'standard',
        colors: {
            '--bg-primary': '#0d0a0f',
            '--bg-secondary': '#150f1a',
            '--bg-card': 'rgba(139, 92, 246, 0.05)',
            '--bg-card-hover': 'rgba(139, 92, 246, 0.1)',
            '--border-color': 'rgba(139, 92, 246, 0.15)',
            '--border-color-light': 'rgba(139, 92, 246, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#8b5cf6',
            '--accent-secondary': '#a78bfa',
            '--accent-tertiary': '#c4b5fd',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    rose: {
        name: 'Rose Gold',
        description: 'Soft pink and gold theme',
        category: 'standard',
        colors: {
            '--bg-primary': '#0f0a0c',
            '--bg-secondary': '#1a1015',
            '--bg-card': 'rgba(244, 114, 182, 0.05)',
            '--bg-card-hover': 'rgba(244, 114, 182, 0.1)',
            '--border-color': 'rgba(244, 114, 182, 0.15)',
            '--border-color-light': 'rgba(251, 191, 36, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#f472b6',
            '--accent-secondary': '#fbbf24',
            '--accent-tertiary': '#fb7185',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    slate: {
        name: 'Slate',
        description: 'Clean minimalist gray theme',
        category: 'standard',
        colors: {
            '--bg-primary': '#0f0f11',
            '--bg-secondary': '#18181b',
            '--bg-card': 'rgba(113, 113, 122, 0.05)',
            '--bg-card-hover': 'rgba(113, 113, 122, 0.1)',
            '--border-color': 'rgba(113, 113, 122, 0.15)',
            '--border-color-light': 'rgba(113, 113, 122, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#71717a',
            '--accent-secondary': '#a1a1aa',
            '--accent-tertiary': '#d4d4d8',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    neon: {
        name: 'Neon',
        description: 'Vibrant cyberpunk neon theme',
        category: 'standard',
        colors: {
            '--bg-primary': '#050508',
            '--bg-secondary': '#0a0a10',
            '--bg-card': 'rgba(0, 255, 136, 0.03)',
            '--bg-card-hover': 'rgba(0, 255, 136, 0.06)',
            '--border-color': 'rgba(0, 255, 136, 0.15)',
            '--border-color-light': 'rgba(255, 0, 255, 0.15)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.8)',
            '--text-muted': 'rgba(255, 255, 255, 0.5)',
            '--accent-primary': '#00ff88',
            '--accent-secondary': '#ff00ff',
            '--accent-tertiary': '#00ffff',
            '--success': '#00ff88',
            '--warning': '#ffff00',
            '--danger': '#ff0055',
            '--info': '#00ffff'
        }
    },

    // ============================================================================
    // HOLIDAY THEMES - USA
    // ============================================================================
    newyear: {
        name: 'New Year\'s',
        description: 'Celebrate the new year with gold & silver',
        category: 'holiday',
        holiday: 'newyear',
        emoji: '🎊',
        colors: {
            '--bg-primary': '#0f0d0a',
            '--bg-secondary': '#1a1712',
            '--bg-card': 'rgba(251, 191, 36, 0.05)',
            '--bg-card-hover': 'rgba(251, 191, 36, 0.1)',
            '--border-color': 'rgba(251, 191, 36, 0.15)',
            '--border-color-light': 'rgba(192, 192, 192, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#fbbf24',
            '--accent-secondary': '#c0c0c0',
            '--accent-tertiary': '#fcd34d',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    mlk: {
        name: 'MLK Day',
        description: 'Honor Dr. Martin Luther King Jr.',
        category: 'holiday',
        holiday: 'mlk',
        emoji: '✊',
        colors: {
            '--bg-primary': '#0a0a0f',
            '--bg-secondary': '#12121a',
            '--bg-card': 'rgba(255, 255, 255, 0.03)',
            '--bg-card-hover': 'rgba(255, 255, 255, 0.06)',
            '--border-color': 'rgba(255, 215, 0, 0.15)',
            '--border-color-light': 'rgba(255, 215, 0, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#ffd700',
            '--accent-secondary': '#ffffff',
            '--accent-tertiary': '#c0c0c0',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    valentines: {
        name: 'Valentine\'s Day',
        description: 'Romantic pink and red hearts',
        category: 'holiday',
        holiday: 'valentines',
        emoji: '💕',
        colors: {
            '--bg-primary': '#0f0a0d',
            '--bg-secondary': '#1f121a',
            '--bg-card': 'rgba(236, 72, 153, 0.05)',
            '--bg-card-hover': 'rgba(236, 72, 153, 0.1)',
            '--border-color': 'rgba(236, 72, 153, 0.15)',
            '--border-color-light': 'rgba(236, 72, 153, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#ec4899',
            '--accent-secondary': '#ef4444',
            '--accent-tertiary': '#f472b6',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    stpatricks: {
        name: 'St. Patrick\'s Day',
        description: 'Lucky Irish green theme',
        category: 'holiday',
        holiday: 'stpatricks',
        emoji: '🍀',
        colors: {
            '--bg-primary': '#0a0f0a',
            '--bg-secondary': '#0f1a0f',
            '--bg-card': 'rgba(34, 197, 94, 0.05)',
            '--bg-card-hover': 'rgba(34, 197, 94, 0.1)',
            '--border-color': 'rgba(34, 197, 94, 0.15)',
            '--border-color-light': 'rgba(251, 191, 36, 0.15)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#22c55e',
            '--accent-secondary': '#fbbf24',
            '--accent-tertiary': '#4ade80',
            '--success': '#22c55e',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    easter: {
        name: 'Easter',
        description: 'Pastel spring colors',
        category: 'holiday',
        holiday: 'easter',
        emoji: '🐰',
        colors: {
            '--bg-primary': '#0f0d10',
            '--bg-secondary': '#1a1520',
            '--bg-card': 'rgba(196, 181, 253, 0.05)',
            '--bg-card-hover': 'rgba(196, 181, 253, 0.1)',
            '--border-color': 'rgba(196, 181, 253, 0.15)',
            '--border-color-light': 'rgba(253, 224, 71, 0.15)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#c4b5fd',
            '--accent-secondary': '#fde047',
            '--accent-tertiary': '#a5f3fc',
            '--success': '#86efac',
            '--warning': '#fde047',
            '--danger': '#fca5a5',
            '--info': '#a5f3fc'
        }
    },
    cincodemayo: {
        name: 'Cinco de Mayo',
        description: 'Vibrant Mexican celebration',
        category: 'holiday',
        holiday: 'cincodemayo',
        emoji: '🇲🇽',
        colors: {
            '--bg-primary': '#0a0f0a',
            '--bg-secondary': '#0f1a0f',
            '--bg-card': 'rgba(34, 197, 94, 0.05)',
            '--bg-card-hover': 'rgba(34, 197, 94, 0.1)',
            '--border-color': 'rgba(239, 68, 68, 0.15)',
            '--border-color-light': 'rgba(34, 197, 94, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#22c55e',
            '--accent-secondary': '#ef4444',
            '--accent-tertiary': '#ffffff',
            '--success': '#22c55e',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    memorial: {
        name: 'Memorial Day',
        description: 'Honor those who served',
        category: 'holiday',
        holiday: 'memorial',
        emoji: '🇺🇸',
        colors: {
            '--bg-primary': '#0a0a0f',
            '--bg-secondary': '#0f1020',
            '--bg-card': 'rgba(59, 130, 246, 0.05)',
            '--bg-card-hover': 'rgba(59, 130, 246, 0.1)',
            '--border-color': 'rgba(239, 68, 68, 0.15)',
            '--border-color-light': 'rgba(59, 130, 246, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#3b82f6',
            '--accent-secondary': '#ef4444',
            '--accent-tertiary': '#ffffff',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    juneteenth: {
        name: 'Juneteenth',
        description: 'Celebrate freedom and heritage',
        category: 'holiday',
        holiday: 'juneteenth',
        emoji: '✊🏿',
        colors: {
            '--bg-primary': '#0f0a0a',
            '--bg-secondary': '#1a0f0f',
            '--bg-card': 'rgba(239, 68, 68, 0.05)',
            '--bg-card-hover': 'rgba(239, 68, 68, 0.1)',
            '--border-color': 'rgba(34, 197, 94, 0.15)',
            '--border-color-light': 'rgba(239, 68, 68, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#ef4444',
            '--accent-secondary': '#22c55e',
            '--accent-tertiary': '#000000',
            '--success': '#22c55e',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    independence: {
        name: '4th of July',
        description: 'Patriotic red, white & blue',
        category: 'holiday',
        holiday: 'independence',
        emoji: '🎆',
        colors: {
            '--bg-primary': '#0a0a10',
            '--bg-secondary': '#0f1025',
            '--bg-card': 'rgba(59, 130, 246, 0.05)',
            '--bg-card-hover': 'rgba(59, 130, 246, 0.1)',
            '--border-color': 'rgba(239, 68, 68, 0.2)',
            '--border-color-light': 'rgba(59, 130, 246, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#3b82f6',
            '--accent-secondary': '#ef4444',
            '--accent-tertiary': '#ffffff',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    labor: {
        name: 'Labor Day',
        description: 'Celebrate American workers',
        category: 'holiday',
        holiday: 'labor',
        emoji: '⚒️',
        colors: {
            '--bg-primary': '#0a0a0f',
            '--bg-secondary': '#12121a',
            '--bg-card': 'rgba(59, 130, 246, 0.05)',
            '--bg-card-hover': 'rgba(59, 130, 246, 0.1)',
            '--border-color': 'rgba(239, 68, 68, 0.15)',
            '--border-color-light': 'rgba(59, 130, 246, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#3b82f6',
            '--accent-secondary': '#ef4444',
            '--accent-tertiary': '#fbbf24',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    halloween: {
        name: 'Halloween',
        description: 'Spooky orange and purple',
        category: 'holiday',
        holiday: 'halloween',
        emoji: '🎃',
        colors: {
            '--bg-primary': '#0d0a0f',
            '--bg-secondary': '#1a0f1f',
            '--bg-card': 'rgba(249, 115, 22, 0.05)',
            '--bg-card-hover': 'rgba(249, 115, 22, 0.1)',
            '--border-color': 'rgba(249, 115, 22, 0.15)',
            '--border-color-light': 'rgba(168, 85, 247, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#f97316',
            '--accent-secondary': '#a855f7',
            '--accent-tertiary': '#000000',
            '--success': '#22c55e',
            '--warning': '#f97316',
            '--danger': '#dc2626',
            '--info': '#a855f7'
        }
    },
    veterans: {
        name: 'Veterans Day',
        description: 'Honor all who served',
        category: 'holiday',
        holiday: 'veterans',
        emoji: '🎖️',
        colors: {
            '--bg-primary': '#0a0a0f',
            '--bg-secondary': '#101020',
            '--bg-card': 'rgba(59, 130, 246, 0.05)',
            '--bg-card-hover': 'rgba(59, 130, 246, 0.1)',
            '--border-color': 'rgba(251, 191, 36, 0.15)',
            '--border-color-light': 'rgba(59, 130, 246, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#3b82f6',
            '--accent-secondary': '#fbbf24',
            '--accent-tertiary': '#ef4444',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    thanksgiving: {
        name: 'Thanksgiving',
        description: 'Warm autumn harvest colors',
        category: 'holiday',
        holiday: 'thanksgiving',
        emoji: '🦃',
        colors: {
            '--bg-primary': '#0f0a08',
            '--bg-secondary': '#1a1510',
            '--bg-card': 'rgba(234, 88, 12, 0.05)',
            '--bg-card-hover': 'rgba(234, 88, 12, 0.1)',
            '--border-color': 'rgba(234, 88, 12, 0.15)',
            '--border-color-light': 'rgba(161, 98, 7, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#ea580c',
            '--accent-secondary': '#a16207',
            '--accent-tertiary': '#dc2626',
            '--success': '#65a30d',
            '--warning': '#f59e0b',
            '--danger': '#dc2626',
            '--info': '#0284c7'
        }
    },
    christmas: {
        name: 'Christmas',
        description: 'Festive red and green',
        category: 'holiday',
        holiday: 'christmas',
        emoji: '🎄',
        colors: {
            '--bg-primary': '#0a0f0a',
            '--bg-secondary': '#1a0f0f',
            '--bg-card': 'rgba(220, 38, 38, 0.05)',
            '--bg-card-hover': 'rgba(220, 38, 38, 0.1)',
            '--border-color': 'rgba(220, 38, 38, 0.15)',
            '--border-color-light': 'rgba(22, 163, 74, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#dc2626',
            '--accent-secondary': '#16a34a',
            '--accent-tertiary': '#fbbf24',
            '--success': '#16a34a',
            '--warning': '#fbbf24',
            '--danger': '#dc2626',
            '--info': '#3b82f6'
        }
    },
    hanukkah: {
        name: 'Hanukkah',
        description: 'Festival of lights - blue and silver',
        category: 'holiday',
        holiday: 'hanukkah',
        emoji: '🕎',
        colors: {
            '--bg-primary': '#0a0a10',
            '--bg-secondary': '#0f1025',
            '--bg-card': 'rgba(59, 130, 246, 0.05)',
            '--bg-card-hover': 'rgba(59, 130, 246, 0.1)',
            '--border-color': 'rgba(192, 192, 192, 0.15)',
            '--border-color-light': 'rgba(59, 130, 246, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#3b82f6',
            '--accent-secondary': '#c0c0c0',
            '--accent-tertiary': '#60a5fa',
            '--success': '#10b981',
            '--warning': '#fbbf24',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    },
    kwanzaa: {
        name: 'Kwanzaa',
        description: 'Celebrate African heritage',
        category: 'holiday',
        holiday: 'kwanzaa',
        emoji: '🕯️',
        colors: {
            '--bg-primary': '#0a0a0a',
            '--bg-secondary': '#151010',
            '--bg-card': 'rgba(239, 68, 68, 0.05)',
            '--bg-card-hover': 'rgba(239, 68, 68, 0.1)',
            '--border-color': 'rgba(22, 163, 74, 0.15)',
            '--border-color-light': 'rgba(239, 68, 68, 0.2)',
            '--text-primary': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.75)',
            '--text-muted': 'rgba(255, 255, 255, 0.45)',
            '--accent-primary': '#ef4444',
            '--accent-secondary': '#16a34a',
            '--accent-tertiary': '#000000',
            '--success': '#16a34a',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6'
        }
    }
};

// Holiday date ranges (month/day format) with descriptions
const HOLIDAY_RANGES = {
    newyear: { 
        name: "New Year's",
        start: { month: 12, day: 30 }, 
        end: { month: 1, day: 2 },
        description: "Dec 30 - Jan 2"
    },
    mlk: { 
        name: "MLK Day",
        start: { month: 1, day: 15 }, 
        end: { month: 1, day: 21 },
        description: "Jan 15-21 (3rd Monday)"
    },
    valentines: { 
        name: "Valentine's Day",
        start: { month: 2, day: 12 }, 
        end: { month: 2, day: 15 },
        description: "Feb 12-15"
    },
    stpatricks: { 
        name: "St. Patrick's Day",
        start: { month: 3, day: 15 }, 
        end: { month: 3, day: 18 },
        description: "Mar 15-18"
    },
    easter: { 
        name: "Easter",
        start: { month: 3, day: 20 }, 
        end: { month: 4, day: 25 },
        description: "Late Mar - Apr (varies)"
    },
    cincodemayo: { 
        name: "Cinco de Mayo",
        start: { month: 5, day: 4 }, 
        end: { month: 5, day: 6 },
        description: "May 4-6"
    },
    memorial: { 
        name: "Memorial Day",
        start: { month: 5, day: 25 }, 
        end: { month: 5, day: 31 },
        description: "May 25-31 (Last Monday)"
    },
    juneteenth: { 
        name: "Juneteenth",
        start: { month: 6, day: 18 }, 
        end: { month: 6, day: 20 },
        description: "Jun 18-20"
    },
    independence: { 
        name: "4th of July",
        start: { month: 7, day: 2 }, 
        end: { month: 7, day: 5 },
        description: "Jul 2-5"
    },
    labor: { 
        name: "Labor Day",
        start: { month: 9, day: 1 }, 
        end: { month: 9, day: 7 },
        description: "Sep 1-7 (1st Monday)"
    },
    halloween: { 
        name: "Halloween",
        start: { month: 10, day: 25 }, 
        end: { month: 11, day: 1 },
        description: "Oct 25 - Nov 1"
    },
    veterans: { 
        name: "Veterans Day",
        start: { month: 11, day: 10 }, 
        end: { month: 11, day: 12 },
        description: "Nov 10-12"
    },
    thanksgiving: { 
        name: "Thanksgiving",
        start: { month: 11, day: 22 }, 
        end: { month: 11, day: 28 },
        description: "Nov 22-28 (4th Thursday)"
    },
    hanukkah: { 
        name: "Hanukkah",
        start: { month: 12, day: 10 }, 
        end: { month: 12, day: 18 },
        description: "Dec 10-18 (varies)"
    },
    christmas: { 
        name: "Christmas",
        start: { month: 12, day: 20 }, 
        end: { month: 12, day: 26 },
        description: "Dec 20-26"
    },
    kwanzaa: { 
        name: "Kwanzaa",
        start: { month: 12, day: 26 }, 
        end: { month: 1, day: 1 },
        description: "Dec 26 - Jan 1"
    }
};

function isDateInRange(date, start, end) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    // Handle ranges that cross year boundary (like New Year)
    if (start.month > end.month) {
        return (month > start.month || (month === start.month && day >= start.day)) ||
               (month < end.month || (month === end.month && day <= end.day));
    }
    
    // Normal range within same year
    if (month < start.month || month > end.month) return false;
    if (month === start.month && day < start.day) return false;
    if (month === end.month && day > end.day) return false;
    return true;
}

function getCurrentHolidayTheme() {
    const now = new Date();
    
    for (const [holiday, range] of Object.entries(HOLIDAY_RANGES)) {
        if (isDateInRange(now, range.start, range.end)) {
            return holiday;
        }
    }
    
    return null;
}

async function getActiveTheme() {
    try {
        // Get theme settings from database
        const settings = await db.get(`
            SELECT 
                theme_name,
                auto_holiday_themes
            FROM theme_settings
            WHERE id = 1
        `);

        if (!settings) {
            return { name: 'darklock', theme: THEMES.darklock, autoHoliday: true };
        }

        let themeName = settings.theme_name || 'darklock';
        const autoHoliday = settings.auto_holiday_themes !== 0;

        // Check for holiday theme override
        if (autoHoliday) {
            const holidayTheme = getCurrentHolidayTheme();
            if (holidayTheme) {
                themeName = holidayTheme;
            }
        }

        return {
            name: themeName,
            theme: THEMES[themeName] || THEMES.darklock,
            autoHoliday: autoHoliday,
            currentHoliday: getCurrentHolidayTheme()
        };
    } catch (err) {
        console.error('[ThemeManager] Error getting active theme:', err);
        return { name: 'darklock', theme: THEMES.darklock, autoHoliday: true };
    }
}

async function setTheme(themeName) {
    if (!THEMES[themeName]) {
        throw new Error('Invalid theme name');
    }

    try {
        await db.run(`
            INSERT OR REPLACE INTO theme_settings (id, theme_name, updated_at)
            VALUES (1, ?, datetime('now'))
        `, [themeName]);

        return true;
    } catch (err) {
        console.error('[ThemeManager] Error setting theme:', err);
        throw err;
    }
}

async function setAutoHolidayThemes(enabled) {
    try {
        await db.run(`
            INSERT OR REPLACE INTO theme_settings (id, auto_holiday_themes, updated_at)
            VALUES (1, ?, datetime('now'))
        `, [enabled ? 1 : 0]);

        return true;
    } catch (err) {
        console.error('[ThemeManager] Error setting auto holiday themes:', err);
        throw err;
    }
}

function getAllThemes() {
    return Object.entries(THEMES).map(([key, theme]) => {
        const holidayRange = theme.holiday ? HOLIDAY_RANGES[theme.holiday] : null;
        return {
            id: key,
            name: theme.name,
            description: theme.description,
            category: theme.category || 'standard',
            holiday: theme.holiday || null,
            emoji: theme.emoji || null,
            holidayDateRange: holidayRange ? holidayRange.description : null,
            preview: theme.colors['--accent-primary'],
            previewSecondary: theme.colors['--accent-secondary']
        };
    });
}

function getHolidayRanges() {
    return HOLIDAY_RANGES;
}

module.exports = {
    THEMES,
    HOLIDAY_RANGES,
    getActiveTheme,
    setTheme,
    setAutoHolidayThemes,
    getAllThemes,
    getCurrentHolidayTheme,
    getHolidayRanges
};
