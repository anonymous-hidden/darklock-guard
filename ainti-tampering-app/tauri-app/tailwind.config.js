/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Darklock brand colors - extracted from darklock.net
        darklock: {
          // Base backgrounds
          bg: {
            primary: '#0a0a0f',      // Main background
            secondary: '#0f0f16',    // Sidebar/cards
            tertiary: '#141420',     // Elevated cards
            hover: '#1a1a28',        // Hover states
            active: '#1f1f30',       // Active/pressed
          },
          // Borders
          border: {
            DEFAULT: 'rgba(255, 255, 255, 0.06)',
            light: 'rgba(255, 255, 255, 0.03)',
            accent: 'rgba(99, 102, 241, 0.4)',
          },
          // Text
          text: {
            primary: '#f0f0f5',
            secondary: '#9090a0',
            muted: '#505060',
            inverse: '#0a0a0f',
          },
          // Accent (Indigo)
          accent: {
            DEFAULT: '#6366f1',
            light: '#818cf8',
            dark: '#4f46e5',
            subtle: 'rgba(99, 102, 241, 0.12)',
          },
          // Status colors
          success: {
            DEFAULT: '#34d399',
            bg: 'rgba(52, 211, 153, 0.12)',
          },
          warning: {
            DEFAULT: '#fbbf24',
            bg: 'rgba(251, 191, 36, 0.12)',
          },
          error: {
            DEFAULT: '#f87171',
            bg: 'rgba(248, 113, 113, 0.12)',
          },
          info: {
            DEFAULT: '#6366f1',
            bg: 'rgba(99, 102, 241, 0.12)',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'darklock': '0 4px 24px rgba(0, 0, 0, 0.4)',
        'darklock-lg': '0 8px 40px rgba(0, 0, 0, 0.5)',
        'glow': '0 0 20px rgba(99, 102, 241, 0.3)',
        'glow-success': '0 0 20px rgba(52, 211, 153, 0.3)',
        'glow-error': '0 0 20px rgba(248, 113, 113, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
