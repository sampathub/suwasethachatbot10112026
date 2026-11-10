import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

function apiFallbackPlugin(): Plugin {
  return {
    name: 'api-fallback',
    configureServer(server) {
      server.middlewares.use('/api/get-ip', (_req, res) => {
        const forwarded = _req.headers['x-forwarded-for'];
        let ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : _req.socket?.remoteAddress || '';
        if (ip.startsWith('::ffff:')) {
          ip = ip.replace('::ffff:', '');
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ip: ip || '127.0.0.1' }));
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiFallbackPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
