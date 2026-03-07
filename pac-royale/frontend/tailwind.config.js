/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'pac-yellow': '#FFE600',
        'pac-blue': '#2121DE',
        'neon-blue': '#00BFFF',
        'neon-pink': '#FF6EC7',
        'neon-green': '#39FF14',
        'neon-purple': '#BF40BF',
        'ghost-red': '#FF0000',
        'ghost-pink': '#FFB8FF',
        'ghost-cyan': '#00FFFF',
        'ghost-orange': '#FFB852',
        'arcade-bg': '#0a0a1a',
      },
      fontFamily: {
        arcade: ['"Press Start 2P"', 'monospace'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 1.5s ease-in-out infinite',
        'float': 'float 2s ease-in-out infinite',
        'chomp': 'chomp 0.3s linear infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.2)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        chomp: {
          '0%': { clipPath: 'polygon(100% 0%, 100% 100%, 50% 50%)' },
          '50%': { clipPath: 'polygon(100% 10%, 100% 90%, 50% 50%)' },
          '100%': { clipPath: 'polygon(100% 0%, 100% 100%, 50% 50%)' },
        },
      },
    },
  },
  plugins: [],
};
