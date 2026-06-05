// web/vite.config.js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:18083', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
