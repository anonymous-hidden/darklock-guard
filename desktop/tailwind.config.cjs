/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0e17',
          secondary: '#0f1420',
          tertiary: '#151c2c',
          card: 'rgba(21, 28, 44, 0.7)',
          cardSolid: '#1a2235'
        },
        accent: {
          primary: '#00f0ff',
          secondary: '#7c3aed',
          tertiary: '#ec4899'
        },
        text: {
          primary: '#ffffff',
          secondary: '#94a3b8',
          muted: '#64748b'
        },
        semantic: {
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444'
        },
        state: {
          zerotrust: '#ec4899',
          safemode: '#f59e0b',
          disconnected: '#64748b'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      },
      boxShadow: {
        glow: '0 0 30px rgba(0, 240, 255, 0.2)',
        glowStrong: '0 0 50px rgba(0, 240, 255, 0.3)'
      },
      borderRadius: {
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        full: '9999px'
      },
      spacing: {
        xs: '0.25rem',
        sm: '0.5rem',
        md: '1rem',
        lg: '1.5rem',
        xl: '2rem',
        '2xl': '3rem',
        '3xl': '4rem',
        '4xl': '6rem'
      }
    }
  },
  plugins: []
};
