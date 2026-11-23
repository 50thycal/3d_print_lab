import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import { createDesign } from './api/design.js';

const require = createRequire(import.meta.url);
const manifoldDirectory = dirname(require.resolve('manifold-3d'));

export default defineConfig({
  resolve: { alias: { '@cad-wasm': join(manifoldDirectory, 'manifold.wasm') } },
  optimizeDeps: { exclude: ['manifold-3d'] },
  plugins: [{
    name: 'printlab-local-api',
    configureServer(server) {
      server.middlewares.use('/api/design', async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { Allow: 'POST' }).end();
          return;
        }
        let body = '';
        try {
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 3_000_000) {
              response.writeHead(413).end();
              return;
            }
          }
          const [status, payload] = await createDesign(JSON.parse(body), request.headers.authorization);
          response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Invalid design request.' }));
        }
      });
    },
  }],
});
