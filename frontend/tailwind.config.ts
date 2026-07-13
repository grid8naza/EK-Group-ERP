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
        // Deep evergreen / pine-teal palette — drives every brand-* usage
        // (primary buttons, active nav, focus rings, brand marks). Primary =
        // brand-600 (#245746), hover = brand-500 (#2f6b58), darkest CTA/mark =
        // brand-800 (#15352c), tint = brand-100 (#d7e7e0). Static tokens (no
        // API/DB theming reads these — a future dynamic theme may swap them).
        brand: {
          50: '#eef4f1',
          100: '#d7e7e0',
          200: '#b0cfc3',
          300: '#82b0a0',
          400: '#54907c',
          500: '#2f6b58',
          600: '#245746',
          700: '#1c463a',
          800: '#15352c',
          900: '#0f2820',
          950: '#081a15',
        },
      },
      boxShadow: {
        // Flat, shadow-free design: surfaces are defined by hairline borders,
        // never elevation. These tokens resolve to nothing so any stray
        // `shadow-soft` / `shadow-card` usage stays invisible.
        soft: 'none',
        card: 'none',
      },
      borderRadius: {
        xl: '0.875rem',
      },
    },
  },
  plugins: [],
};

export default config;
