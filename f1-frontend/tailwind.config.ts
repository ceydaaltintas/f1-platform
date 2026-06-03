import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        f1red: '#E10600',
        f1teal: '#00D2BE',
        f1orange: '#FF8700',
      },
    },
  },
  plugins: [],
} satisfies Config
