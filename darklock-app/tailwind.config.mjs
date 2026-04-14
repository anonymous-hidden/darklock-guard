/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#1e1f22',
        'bg-secondary': '#2b2d31',
        'bg-tertiary': '#313338',
        'bg-hover': '#35373c',
        'bg-active': '#404249',
        'text-primary': '#f2f3f5',
        'text-secondary': '#b5bac1',
        'text-muted': '#80848e',
        accent: '#5865f2',
        'accent-hover': '#4752c4',
        danger: '#ed4245',
        success: '#23a55a',
        warning: '#f0b232',
        border: '#1e1f22'
      },
      width: {
        'server-sidebar': '72px',
        'channel-sidebar': '240px',
        'members-list': '240px'
      }
    }
  },
  plugins: []
}
