import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // NOTE: Do NOT inject API keys via `define` here — that would embed them in
      // the public client bundle. All keys stay server-side (api/handlers.ts),
      // reached only through the /api/* endpoints.
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
