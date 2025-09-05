import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // By default, Vite doesn't include shims for NodeJS/CJS globals.
    // This adds `global` to the global scope.
    global: {},
  },
  resolve: {
    alias: {
      // This is the important part to polyfill Buffer
      'buffer': 'buffer/',
    },
  },
})