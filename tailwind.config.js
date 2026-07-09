/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        zunion: {
          red: "#ed1c24",
          dark: "#242424",
          gray: "#f4f4f5"
        }
      },
      fontFamily: {
        sans: ["Tahoma", "Arial", "sans-serif"]
      }
    },
  },
  plugins: [],
};
