import { defineConfig, loadEnv, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const jsxInJs = {
  name: 'jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    if (!/\/src\/.*\.js$/.test(id)) return null;
    return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
  },
};

export function createSentryBuildConfig(env) {
  if (env.SENTRY_SOURCE_MAPS_ENABLED !== '1') return { plugin: null, sourcemap: false };
  const required = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_FRONTEND_PROJECT', 'RAILWAY_GIT_COMMIT_SHA', 'SENTRY_RELEASE', 'VITE_SENTRY_RELEASE'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing Sentry source-map settings: ${missing.join(', ')}`);
  if (env.SENTRY_RELEASE !== env.RAILWAY_GIT_COMMIT_SHA || env.VITE_SENTRY_RELEASE !== env.SENTRY_RELEASE) {
    throw new Error('Sentry release values must match exactly');
  }
  return {
    sourcemap: 'hidden',
    plugin: sentryVitePlugin({
      authToken: env.SENTRY_AUTH_TOKEN,
      org: env.SENTRY_ORG,
      project: env.SENTRY_FRONTEND_PROJECT,
      release: { name: env.SENTRY_RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: './build/**/*.map' },
    }),
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const sentry = createSentryBuildConfig(env);
  return {
  plugins: [
    jsxInJs,
    react(),
    legacy({ targets: ['> 0.2%', 'not dead', 'not op_mini all'] }),
    nodePolyfills({
      include: ['buffer', 'process', 'stream'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    sentry.plugin,
  ].filter(Boolean),
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
    sourcemap: sentry.sourcemap,
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
  };
});
