/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{html,js,ts}'],
  theme: {
    extend: {
      colors: {
        primary: {
          light: '#F4EFE6',
          default: '#A18249',
          dark: '#1C160C',
        },
        success: '#019863',
        white: '#FFFFFF',
        orange: {
          100: '#FFEDD5', // 添加 Tailwind 預設的淺橘色
          200: '#FED7AA',
          500: '#F97316',
          900: '#7C2D12',
        },
      },
    },
  },
  plugins: [],
};


