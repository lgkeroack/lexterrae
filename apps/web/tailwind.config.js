/** @type {import('tailwindcss').Config} */

// Black-on-white, legal-document styling. Every colour name used in the app maps to a
// monochrome scale, so existing utility classes (bg-blue-600, text-red-700, …) render in
// black, white and greys without touching each component.

// Greys for rules, secondary text and subtle fills (dark enough for AA contrast from 500 up)
const grey = {
  50: '#fafafa',
  100: '#f2f2f2',
  200: '#e0e0e0',
  300: '#bdbdbd',
  400: '#8a8a8a',
  500: '#595959',
  600: '#404040',
  700: '#2b2b2b',
  800: '#1a1a1a',
  900: '#0d0d0d',
  950: '#000000',
};

// Former accent colours: pale tints for backgrounds, solid black for ink and actions
const ink = {
  50: '#f5f5f5',
  100: '#ebebeb',
  200: '#d6d6d6',
  300: '#a8a8a8',
  400: '#6e6e6e',
  500: '#1a1a1a',
  600: '#000000',
  700: '#000000',
  800: '#000000',
  900: '#000000',
  950: '#000000',
};

const serif = ['"Times New Roman"', 'Times', 'Liberation Serif', 'serif'];
const rule = '0 0 0 1px #000000';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      black: '#000000',
      white: '#ffffff',
      gray: grey,
      slate: grey,
      neutral: grey,
      blue: ink,
      green: ink,
      red: ink,
      amber: ink,
      yellow: ink,
      purple: ink,
      map: {
        unselected: '#ffffff',
        hover: '#d6d6d6',
        selected: '#000000',
        federal: '#000000',
      },
    },
    fontFamily: {
      sans: serif,
      serif,
      mono: ['"Courier New"', 'Courier', 'monospace'],
    },
    // Times reads small; nudge the text scale up a step
    fontSize: {
      xs: ['0.8125rem', { lineHeight: '1.15rem' }],
      sm: ['0.9375rem', { lineHeight: '1.4rem' }],
      base: ['1.0625rem', { lineHeight: '1.6rem' }],
      lg: ['1.1875rem', { lineHeight: '1.75rem' }],
      xl: ['1.375rem', { lineHeight: '1.9rem' }],
      '2xl': ['1.625rem', { lineHeight: '2.1rem' }],
      '3xl': ['2rem', { lineHeight: '2.4rem' }],
      '4xl': ['2.5rem', { lineHeight: '2.8rem' }],
    },
    // Square corners throughout; `full` stays round for spinners and toggles
    borderRadius: {
      none: '0',
      sm: '0',
      DEFAULT: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '9999px',
    },
    // No soft shadows: raised surfaces get a hairline black rule instead
    boxShadow: {
      none: 'none',
      sm: 'none',
      DEFAULT: rule,
      md: rule,
      lg: rule,
      xl: rule,
      '2xl': rule,
      inner: 'none',
    },
    extend: {},
  },
  plugins: [],
};
