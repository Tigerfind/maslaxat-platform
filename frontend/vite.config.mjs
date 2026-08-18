import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const jsxInJs = {
  name: 'jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    if (!/\/src\/.*\.js$/.test(id)) return null;
    return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
  },
};

export default defineConfig({
  plugins: [
    jsxInJs,
    react(),
    legacy({ targets: ['> 0.2%', 'not dead', 'not op_mini all'] }),
    nodePolyfills({
      include: ['buffer', 'process', 'stream'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/uploads': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'build',
    sourcemap: false,
    manifest: 'asset-manifest.json',
  },
  optimizeDeps: {
    esbuildOptions: { loader: { '.js': 'jsx' } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    include: ['src/**/*.test.js'],
    css: true,
  },
});
