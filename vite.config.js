import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Punkt Elements are web components.
          isCustomElement: (tag) => tag.startsWith('pkt-'),
        },
      },
    }),
  ],
  base: '/',
  publicDir: 'public',
  server: {
    port: 8080,
    // The Node backend (server/) runs on port 3000 in development.
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  define: {
    // eslint-disable-next-line prettier/prettier
    '__APP_VERSION__': JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(import.meta.dirname, 'src'),
      },
    ],
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `
        @use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/breakpoints' as *;
        `,
      },
    },
    postcss: {},
  },
  build: {
    outDir: 'dist',
    assetsDir: '',
    sourcemap: true,
  },
});
