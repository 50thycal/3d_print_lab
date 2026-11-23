import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleSubscription } from '../api/subscription.js';
import { bracket } from '../src/spec.js';

const secret = 'this-is-a-fake-owner-code-for-tests';
const sameOrigin = { host: 'printlab.test', origin: 'https://printlab.test', 'content-type': 'application/json' };
const get = (headers = {}) => ({ method: 'GET', headers });
const post = (body, headers = {}) => ({ method: 'POST', headers: { ...sameOrigin, ...headers }, body });

test('blocks guests, cross-origin actions and invalid codes before reaching the worker', async () => {
  const noWorker = () => assert.fail('request reached the worker');
  const options = { secret, call: noWorker };
  assert.deepEqual(await handleSubscription(get(), options), { status: 200, payload: { available: true, owner: false } });
  assert.equal((await handleSubscription(post({ action: 'connect' }), options)).status, 401);
  assert.equal((await handleSubscription(post({ action: 'unlock', code: secret }, { origin: 'https://evil.test' }), options)).status, 403);
  assert.equal((await handleSubscription(post({ action: 'unlock', code: 'nope' }), options)).status, 401);
});

test('signed owner browser session gates status and generation and expires', async () => {
  const call = async (action, input) => {
    if (action === 'status') return { status: 200, payload: { connected: true, plan: 'plus' } };
    assert.equal(action, 'generate');
    assert.equal(input.description, 'A bracket');
    return { status: 200, payload: { design: bracket } };
  };
  const options = { secret, now: 1000, call };
  const unlock = await handleSubscription(post({ action: 'unlock', code: secret }), options);
  assert.match(unlock.setCookie, /Secure; HttpOnly; SameSite=Strict/);
  const cookie = unlock.setCookie.split(';')[0];
  const headers = { cookie };
  assert.equal((await handleSubscription(get(headers), options)).payload.plan, 'plus');
  assert.deepEqual((await handleSubscription(post({ action: 'generate', input: { description: 'A bracket' } }, headers), options)).payload.design, bracket);
  assert.equal((await handleSubscription(post({ action: 'generate', input: { image: 'https://example.com/photo' } }, headers), options)).status, 400);
  assert.equal((await handleSubscription(post({ action: 'connect' }, { cookie: cookie + 'x' }), options)).status, 401);
  assert.equal((await handleSubscription(post({ action: 'connect' }, headers), { ...options, now: 30 * 24 * 60 * 60 + 1001 })).status, 401);
  assert.match((await handleSubscription(post({ action: 'lock' }, headers), options)).setCookie, /Max-Age=0/);
});

test('Codex device sign-in and photo turn use the documented private protocol', async () => {
  const root = await mkdtemp(join(tmpdir(), 'printlab-codex-test-'));
  let codex;
  try {
    await copyFile(new URL('../subscription/codex.mjs', import.meta.url), join(root, 'codex.mjs'));
    await copyFile(new URL('../src/spec.js', import.meta.url), join(root, 'spec.mjs'));
    const binary = join(root, 'mock-codex');
    const source = `#!${process.execPath}
const { createInterface } = require('node:readline');
const { existsSync } = require('node:fs');
let connected = false;
const reply = (id, result) => console.log(JSON.stringify({ id, result }));
const event = (method, params) => console.log(JSON.stringify({ method, params }));
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  switch (method) {
    case 'initialize': return reply(id, {});
    case 'initialized': return;
    case 'account/read': return reply(id, { account: connected ? { type: 'chatgpt', planType: 'plus' } : null });
    case 'account/login/start':
      if (params.type !== 'chatgptDeviceCode') process.exit(1);
      setTimeout(() => {
        connected = true;
        event('account/login/completed', { loginId: 'login', success: true });
      }, 50);
      return reply(id, { type: 'chatgptDeviceCode', loginId: 'login', userCode: 'EXAMPLE-CODE', verificationUrl: 'https://auth.openai.com/codex/device' });
    case 'thread/start':
      if (!params.ephemeral || params.approvalPolicy !== 'never' || params.sandbox !== 'read-only') process.exit(1);
      return reply(id, { thread: { id: 'design' } });
    case 'turn/start':
      if (!params.outputSchema || params.input[1]?.type !== 'localImage' || !existsSync(params.input[1].path)) process.exit(1);
      event('item/completed', { threadId: 'design', turnId: 'turn', item: {
        type: 'agentMessage', phase: 'final_answer', text: ${JSON.stringify(JSON.stringify(bracket))},
      } });
      event('turn/completed', { threadId: 'design', turn: { id: 'turn', status: 'completed', items: [] } });
      return reply(id, { turn: { id: 'turn' } });
    case 'account/logout': connected = false; return reply(id, {});
    case 'thread/unsubscribe': return reply(id, {});
    default: process.exit(1);
  }
});`;
    await writeFile(binary, source);
    await chmod(binary, 0o700);
    const { Codex } = await import(pathToFileURL(join(root, 'codex.mjs')).href);
    codex = new Codex(root, binary);
    const loggedIn = new Promise(resolve => codex.events.once('account/login/completed', resolve));
    assert.equal((await codex.connect()).login.code, 'EXAMPLE-CODE');
    await loggedIn;
    assert.deepEqual(await codex.status(), { connected: true, plan: 'plus' });
    const result = await codex.design({
      description: 'A bracket 64 mm wide', measurement: '',
      image: 'data:image/png;base64,aW1hZ2U=', previous: null,
    });
    assert.deepEqual(result, [200, { design: bracket }]);
    assert.deepEqual(await codex.disconnect(), { connected: false });
  } finally {
    codex?.stop();
    await rm(root, { force: true, recursive: true });
  }
});
