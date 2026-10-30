/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
theme: {
    extend: {
      fontFamily: {
        sans: ['"Metropolis"', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#F0F5F1',
          100: '#D9E4DB',
          200: '#B6CABA',
          300: '#8AAA90',
          400: '#5C8867',
          500: '#3F6B49',
          600: '#2A5234',
          700: '#1F3A2E', // Forest — base
          800: '#173127',
          900: '#10261F',
          950: '#0A1815',
        },
        ivory:  '#F5EFD7',
        cherry: '#B8341E',
        honey:  '#C99547',
        wood:   '#4A2F1A',
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        'card': '0 1px 3px rgba(0,0,0,0.05), 0 10px 15px -5px rgba(0,0,0,0.02)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fadeIn': 'fadeIn 0.5s ease-out',
        'scaleIn': 'scaleIn 0.2s ease-out',
        'blink-ring': 'blinkRing 1.2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        // Halo jaune pulsant (amber-400). N'anime que le box-shadow : contrairement à
        // animate-pulse, le contenu de l'élément reste lisible en permanence.
        blinkRing: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(251, 191, 36, 0)' },
          '50%':      { boxShadow: '0 0 0 5px rgba(251, 191, 36, 0.55)' },
        },
      },
      backgroundColor: {
        'primary': 'var(--color-bg-primary)',
        'secondary': 'var(--color-bg-secondary)',
        'tertiary': 'var(--color-bg-tertiary)',
      },
      textColor: {
        'primary': 'var(--color-text-primary)',
        'secondary': 'var(--color-text-secondary)',
        'tertiary': 'var(--color-text-tertiary)',
      },
      borderColor: {
        'primary': 'var(--color-border)',
      },
    },
  },
  plugins: [],
}