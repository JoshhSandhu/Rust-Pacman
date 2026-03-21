import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  define: {
    'process.env': {},
  },
  // Allow Vite to import files from the monorepo root (needed for target/idl/*.json)
  server: {
    port: 3000,
    fs: {
      // Allow serving files from the workspace root and up two levels
      allow: [
        path.resolve(__dirname, '..'),
        path.resolve(__dirname),
      ],
    },
  },
  preview: {
    port: 3002,
    host: true,
    allowedHosts: ['pacroyal.lynxjosh.cyou'],
  },
  resolve: {
    alias: {
      // Convenience alias so anchorClient.ts can import the IDL cleanly
      '@idl': path.resolve(__dirname, '../target/idl'),
    },
  },
});
