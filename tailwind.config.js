/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: 'var(--navi-border)',
        input: 'var(--navi-border)',
        ring: 'var(--navi-primary)',
        background: 'var(--navi-content)',
        foreground: 'var(--navi-text)',
        primary: {
          DEFAULT: 'var(--navi-primary)',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: 'var(--navi-text-secondary)',
          foreground: 'var(--navi-text)',
        },
        destructive: {
          DEFAULT: 'var(--navi-error)',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: 'var(--navi-content)',
          foreground: 'var(--navi-text-secondary)',
        },
        accent: {
          DEFAULT: 'var(--navi-accent)',
          foreground: '#FFFFFF',
        },
        card: {
          DEFAULT: 'var(--navi-card)',
          foreground: 'var(--navi-text)',
        },
      },
    },
  },
  plugins: [],
}
