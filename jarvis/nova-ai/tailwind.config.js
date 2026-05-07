/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        nova: {
          bg:        '#0a0a0f',
          panel:     '#13131c',
          panel2:    '#1a1a25',
          border:    '#23232f',
          text:      '#e8e8f0',
          muted:     '#8a8a9a',
          accent:    '#00d4ff',
          accent2:   '#7c5cff',
          ok:        '#3ddc84',
          warn:      '#ffb347',
          err:       '#ff5577',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['Syne', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.55' },
        },
        slideUp: {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to:   { transform: 'translateY(0)',   opacity: '1' },
        },
        cursorBlink: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0' },
        },
      },
      animation: {
        'pulse-soft': 'pulseSoft 1.6s ease-in-out infinite',
        'slide-up':   'slideUp 220ms ease-out',
        'cursor':     'cursorBlink 1s steps(2,start) infinite',
      },
    },
  },
  plugins: [],
};
