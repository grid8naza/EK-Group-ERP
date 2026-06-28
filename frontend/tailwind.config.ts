import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Warm "bakery" coffee/gold palette — drives every brand-* usage
        // (primary buttons, active nav, focus rings, header gradients). Primary
        // = brand-600 (#8F5A1E), hover = brand-500 (#A56A24), gold = brand-400
        // (#C98A25), tint = brand-100 (#F7EBD7). A future dynamic theme swaps these.
        brand: {
          50: '#faf6ef',
          100: '#f7ebd7',
          200: '#ead3ac',
          300: '#d9b27a',
          400: '#c98a25',
          500: '#a56a24',
          600: '#8f5a1e',
          700: '#774a18',
          800: '#5e3b14',
          900: '#4a2f11',
          950: '#2b1b0a',
        },
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        // Warm, soft card shadow tuned to the bakery palette.
        card: '0 8px 24px rgba(87, 58, 24, 0.06)',
      },
      borderRadius: {
        xl: '0.875rem',
      },
    },
  },
  plugins: [],
};

export default config;
