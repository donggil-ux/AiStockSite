import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0D1117', card: '#161B22', hover: '#1C222B' },
        up: '#22C55E',
        down: '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'glow-blue': '0 8px 24px -8px rgb(59 130 246 / 0.25)',
      },
    },
  },
  plugins: [],
} satisfies Config;
