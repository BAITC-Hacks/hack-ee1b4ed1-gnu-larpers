import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: '/index.html' } },
    }),
    react(),
  ],
  optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/sigma/') || id.includes('/node_modules/@sigma/')) return 'graph-renderer';
          if (id.includes('/node_modules/three/')) return 'graph-3d';
        },
      },
    },
  },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      ...(process.env.MONEY_GRAPH_AGENT === '1' ? { '/generated': 'http://127.0.0.1:8000' } : {}),
    },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
