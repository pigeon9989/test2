import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

const REMOTE_NAME = 'pomodoro';
// Absolute URL so the emitted mf-manifest.json's `publicPath` is fully-qualified;
// otherwise the host runtime resolves against its own origin and 404s.
const GITHUB_PAGES_BASE = 'https://pigeon9989.github.io/test2/';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_PORT ?? 5179);
  const origin = env.VITE_ORIGIN ?? `http://localhost:${port}`;
  const isBuild = command === 'build';

  return {
    base: isBuild ? GITHUB_PAGES_BASE : '/',
    plugins: [
      react(),
      federation({
        name: REMOTE_NAME,
        filename: 'remoteEntry.js',
        manifest: true,
        exposes: { './App': './src/expose/App.tsx' },
        shared: {
          react: { singleton: true, requiredVersion: '^18.3.0' },
          'react-dom': { singleton: true, requiredVersion: '^18.3.0' },
        },
        dts: false,
      }),
    ],
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    server: { port, strictPort: true, cors: true, origin },
    preview: { port, strictPort: true, cors: true },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
