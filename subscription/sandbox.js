import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

const sandboxName = 'printlab-chatgpt';
let sourceFiles;
function sources() {
  sourceFiles ??= Promise.all([
    readFile(join(process.cwd(), 'subscription/worker.mjs'), 'utf8'),
    readFile(join(process.cwd(), 'subscription/codex.mjs'), 'utf8'),
    readFile(join(process.cwd(), 'src/spec.js'), 'utf8'),
    readFile(join(process.cwd(), 'src/design-input.js'), 'utf8'),
  ]).then(([worker, codex, spec, input]) => ({
    'worker.mjs': worker, 'codex.mjs': codex, 'spec.mjs': spec,
    'design-input.mjs': input.replace("'./spec.js'", "'./spec.mjs'"),
  }));
  return sourceFiles;
}

const installAndRun = `set -eu
umask 077
if [ ! -x "$1/node_modules/.bin/codex" ]; then
  npm install --prefix "$1" --no-audit --no-fund --no-progress @openai/codex@0.163.0 >/dev/null
fi
exec node "$2" serve "$1"
`;

async function atStage(stage, callback) {
  try { return await callback(); }
  catch (error) {
    throw Object.assign(new Error('The ChatGPT worker could not start.'), {
      stage,
      code: error?.code ?? error?.name,
      status: error?.status ?? error?.response?.status,
    });
  }
}

export async function sandboxRequest(action, input) {
  const files = await atStage('read-source', sources);
  const { Sandbox } = await atStage('load-sdk', () => import('@vercel/sandbox'));
  const sandbox = await atStage('open-sandbox', () => Sandbox.getOrCreate({
    name: sandboxName, persistent: true, resources: { vcpus: 1 },
    timeout: 10 * 60_000, keepLastSnapshots: { count: 1 },
  }));
  const root = posix.join(sandbox.cwd, '.printlab-codex');
  const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 18);
  const sourceDir = posix.join(root, version);
  const script = posix.join(sourceDir, 'worker.mjs');
  const id = randomUUID();
  const requestPath = posix.join(root, id + '.request');
  const responsePath = posix.join(root, id + '.response');
  const initialized = await sandbox.runCommand('mkdir', ['-p', sourceDir]);
  if (initialized.exitCode !== 0) throw new Error('Could not prepare the ChatGPT worker.');
  try {
    await sandbox.writeFiles([
      ...Object.entries(files).map(([name, content]) => ({
        path: posix.join(sourceDir, name), content: Buffer.from(content), mode: 0o600,
      })),
      { path: requestPath, content: Buffer.from(JSON.stringify({ action, input })), mode: 0o600 },
    ]);
    // Starting again is safe. A single OS lock protects the worker and its account.
    await sandbox.runCommand({
      cmd: 'flock', args: ['-n', '-F', posix.join(root, 'worker.lock'), 'bash', '-c', installAndRun, 'printlab', root, script],
      detached: true,
    });
    const call = await sandbox.runCommand('node', [script, 'send', root, requestPath, responsePath]);
    if (call.exitCode !== 0) throw new Error('The ChatGPT worker did not respond.');
    const result = await sandbox.readFileToBuffer({ path: responsePath });
    if (!result) throw new Error('No response from the ChatGPT worker.');
    return JSON.parse(result.toString('utf8'));
  } finally {
    await sandbox.runCommand('rm', ['-f', requestPath, responsePath]).catch(() => {});
  }
}
