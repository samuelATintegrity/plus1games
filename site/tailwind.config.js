/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // GameBoy DMG palette
        gb: {
          darkest: '#0f380f',
          dark: '#306230',
          light: '#8bac0f',
          lightest: '#9bbc0f',
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
      },
    },
  },
  plugins: [],
};
