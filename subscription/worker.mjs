import { createServer, request } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Codex } from './codex.mjs';
import { readDesignInput } from './design-input.mjs';

const [mode, root, inputPath, outputPath] = process.argv.slice(2);
const socketPath = join(root, 'worker.sock');

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function serve() {
  await rm(socketPath, { force: true });
  const codex = new Codex(root, join(root, 'node_modules/.bin/codex'));
  let active = false;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method unavailable.' });
    let payload;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 3_100_000) return json(res, 413, { error: 'The request is too large.' });
        chunks.push(chunk);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return json(res, 400, { error: 'Invalid request.' });
    }
    const { action, input } = payload || {};
    if (action === 'status') {
      try { return json(res, 200, await codex.status()); }
      catch { return json(res, 503, { error: 'The ChatGPT connection could not start. Try again.' }); }
    }
    if (!['connect', 'cancel', 'disconnect', 'generate'].includes(action)) {
      return json(res, 400, { error: 'Unknown ChatGPT action.' });
    }
    if (active) return json(res, 409, { error: 'Another ChatGPT action is in progress. Try again in a moment.' });
    active = true;
    try {
      if (action === 'generate') {
        let normalized;
        try { normalized = readDesignInput(input); }
        catch (error) { return json(res, 400, { error: error.message }); }
        const [status, data] = await codex.design(normalized);
        return json(res, status, data);
      }
      return json(res, 200, await codex[action]());
    } catch {
      const error = {
        connect: 'Could not start device sign-in. Check that device code authorization is enabled in ChatGPT Security settings.',
        generate: 'ChatGPT could not complete that design. Check plan usage or try a simpler brief.',
      }[action] ?? 'The ChatGPT connection could not be updated. Try again.';
      return json(res, 502, { error });
    } finally {
      active = false;
    }
  });
  server.listen(socketPath);
  process.once('SIGTERM', () => {
    codex.stop();
    server.close();
  });
}

function call(payload) {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, async res => {
      try {
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        resolve({ status: res.statusCode, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
    req.setTimeout(90_000, () => req.destroy(new Error('Worker timed out.')));
    req.end(payload);
  });
}

async function send() {
  let payload;
  try { payload = await readFile(inputPath); }
  finally { await rm(inputPath, { force: true }); }
  const until = Date.now() + 42_000;
  while (true) {
    try {
      const result = await call(payload);
      await writeFile(outputPath, JSON.stringify(result), { mode: 0o600 });
      return;
    } catch (error) {
      if (!['ECONNREFUSED', 'ENOENT'].includes(error.code) || Date.now() > until) throw error;
      await delay(350);
    }
  }
}

try {
  if (mode === 'serve') await serve();
  else if (mode === 'send') await send();
  else process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
