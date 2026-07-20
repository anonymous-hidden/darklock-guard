/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Darklock brand palette
        // dl-accent uses a CSS custom property so AppearanceTab can change it at runtime.
        // CSS var: --dl-accent-rgb must be kept in sync (space-separated R G B).
        dl: {
          bg:        "#0a0b0f",
          surface:   "#111218",
          elevated:  "#1a1b24",
          border:    "#2a2b38",
          accent: ({ opacityValue }: { opacityValue?: string }) =>
            opacityValue !== undefined
              ? `rgb(var(--dl-accent-rgb) / ${opacityValue})`
              : "rgb(var(--dl-accent-rgb))",
          "accent-dim": ({ opacityValue }: { opacityValue?: string }) =>
            opacityValue !== undefined
              ? `rgb(var(--dl-accent-rgb) / ${opacityValue})`
              : "rgb(var(--dl-accent-rgb))",
          success:   "#22c55e",
          warning:   "#f59e0b",
          danger:    "#ef4444",
          muted:     "#6b7280",
          text:      "#e2e8f0",
          "text-dim":"#94a3b8",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
