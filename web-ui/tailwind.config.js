/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        atlas: {
          red: '#ef4444',
          dark: '#0a0a0a',
          card: '#1a1a1a',
          border: '#2a2a2a',
        },
      },
    },
  },
  plugins: [],
};
