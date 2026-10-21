/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: '#002C80', navy: '#001A4D', gold: '#D4A843', amber: '#F59E0B',
          bg: '#F8FAFC', body: '#64748B', border: '#E2E8F0', line: '#CBD5E1',
        },
      },
      fontFamily: {
        heading: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Familjen Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}