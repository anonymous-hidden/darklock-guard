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
          bg:        '#0d0e11',
          panel:     '#17191f',
          panel2:    '#20232b',
          border:    '#30343d',
          text:      '#f2f4f8',
          muted:     '#9aa3b2',
          accent:    '#64d2ff',
          accent2:   '#b48cff',
          ok:        '#3ddc84',
          warn:      '#ffd166',
          err:       '#ff6b8a',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'system-ui', 'sans-serif', 'Inter'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', 'system-ui', 'sans-serif', 'Inter'],
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
