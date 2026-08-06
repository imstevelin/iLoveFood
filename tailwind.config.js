/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  purge: {
    enabled: true,
    content: ['./src/**/*.{html,js,ts}'],
  },
  theme: {
    extend: {
      colors: {
        primary: {
          light: '#F5F2ED',
          default: '#D97757',
          dark: '#1D1C1A',
        },
        success: '#10B981',
        white: '#FFFFFF',
        orange: {
          100: '#FFEDD5',
          200: '#FED7AA',
          500: '#F97316',
          900: '#7C2D12',
        },
      },
    },
  },
  plugins: [],
};
