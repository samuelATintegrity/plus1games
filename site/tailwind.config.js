/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // DSi-inspired palette (kept gb prefix for compat)
        gb: {
          darkest: '#16213e',
          dark: '#1a2744',
          light: '#4fa3d1',
          lightest: '#eaf1f7',
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
      },
      boxShadow: {
        dsi: '0 2px 8px rgba(13, 27, 42, 0.4)',
      },
    },
  },
  plugins: [],
};
