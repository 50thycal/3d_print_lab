import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkPhotoScale, designInstructions, designPrompt, designSchema, validateDesign } from './spec.mjs';

const settings = {
  'features.shell_tool': false, 'features.shell_snapshot': false,
  'features.apps': false, 'features.multi_agent': false,
  'features.computer_use': false, 'features.browser_use': false,
  'features.browser_use_external': false, 'features.code_mode': false,
  'features.code_mode_host': false, 'features.view_image': false,
  'features.tool_suggest': false, 'features.skill_search': false,
  'features.workspace_dependencies': false,
  'web_search': 'disabled', 'project_doc_max_bytes': 0,
  'cli_auth_credentials_store': 'file', 'forced_login_method': 'chatgpt',
  'analytics.enabled': false,
};

export const deviceURL = 'https://auth.openai.com/codex/device';

export class Codex {
  constructor(root, binary) {
    this.home = join(root, 'codex-home');
    this.workspace = join(root, 'workspace');
    this.binary = binary;
    this.events = new EventEmitter();
    this.pending = new Map();
    this.requestId = 0;
    this.login = null;
    this.loginFailed = false;
  }

  async start() {
    if (!this.starting) {
      this.starting = this.open().catch(error => {
        this.stop();
        throw error;
      });
    }
    return this.starting;
  }

  async open() {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    await chmod(this.home, 0o700);
    await mkdir(this.workspace, { recursive: true, mode: 0o700 });
    const args = ['app-server', '--listen', 'stdio://'];
    for (const [key, value] of Object.entries(settings)) args.push('-c', key + '=' + JSON.stringify(value));
    const child = spawn(this.binary, args, {
      cwd: this.workspace,
      env: { PATH: process.env.PATH, HOME: this.home, CODEX_HOME: this.home, LANG: 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.child = child;
    const close = () => { if (this.child === child) this.stop(); };
    child.once('error', close);
    child.once('exit', close);
    child.stdin.on('error', close);
    createInterface({ input: child.stdout }).on('line', line => {
      if (this.child !== child) return;
      if (line.length > 5_000_000) return this.stop();
      try { this.message(JSON.parse(line)); } catch { /* Never log provider messages. */ }
    });
    await this.rpc('initialize', { clientInfo: { name: 'printlab_ai', title: 'PrintLab AI', version: '0.2.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.starting = null;
    this.login = null;
    child?.kill('SIGKILL');
    for (const { settle } of this.pending.values()) settle(new Error('Codex disconnected.'));
    this.events.emit('stopped');
  }

  rpc(method, params, timeout = 12_000) {
    const child = this.child;
    if (!child?.stdin.writable) return Promise.reject(new Error('Codex disconnected.'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const settle = (error, value) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => settle(new Error('Codex did not respond.')), timeout);
      this.pending.set(id, { settle });
      child.stdin.write(JSON.stringify({ method, id, params }) + '\n', error => {
        if (error) settle(new Error('Codex disconnected.'));
      });
    });
  }

  message(message) {
    if (message.method && Object.hasOwn(message, 'id')) {
      this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Tool unavailable.' } }) + '\n');
      return;
    }
    if (Object.hasOwn(message, 'id')) {
      const error = message.error ? new Error('Codex rejected the request.') : null;
      this.pending.get(message.id)?.settle(error, message.result);
      return;
    }
    const { method, params } = message;
    if (method === 'account/login/completed' && this.login?.id === params?.loginId) {
      this.login = null;
      this.loginFailed = !params.success;
    }
    this.events.emit(method, params);
  }

  async status() {
    await this.start();
    const { account } = await this.rpc('account/read', { refreshToken: false });
    if (account?.type === 'chatgpt') {
      this.login = null;
      return { connected: true, plan: account.planType ?? null };
    }
    const login = this.login && this.login.expiresAt > Date.now() ? this.login.public : null;
    return { connected: false, login, loginFailed: this.loginFailed };
  }

  async connect() {
    const status = await this.status();
    if (status.connected || status.login) return status;
    if (this.login) await this.cancel();
    this.loginFailed = false;
    const result = await this.rpc('account/login/start', { type: 'chatgptDeviceCode' }, 25_000);
    if (result.type !== 'chatgptDeviceCode' || result.verificationUrl !== deviceURL ||
        typeof result.loginId !== 'string' || !/^[A-Z0-9-]{6,20}$/i.test(result.userCode)) {
      throw new Error('Unexpected device approval response.');
    }
    this.login = {
      id: result.loginId, expiresAt: Date.now() + 8 * 60_000,
      public: { code: result.userCode, url: deviceURL },
    };
    return { connected: false, login: this.login.public };
  }

  async cancel() {
    await this.start();
    if (this.login) await this.rpc('account/login/cancel', { loginId: this.login.id });
    this.login = null;
    this.loginFailed = false;
    return this.status();
  }

  async disconnect() {
    await this.cancel();
    await this.rpc('account/logout');
    return { connected: false };
  }

  async design(input) {
    if (!(await this.status()).connected) return [401, { error: 'Connect ChatGPT in AI settings first.' }];
    const cwd = await mkdtemp(join(this.workspace, 'design-'));
    let threadId;
    try {
      const message = [{ type: 'text', text: designPrompt(input) }];
      if (input.image) {
        const [, format, bytes] = input.image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/i);
        const path = join(cwd, 'reference.' + format);
        await writeFile(path, Buffer.from(bytes, 'base64'), { mode: 0o600 });
        message.push({ type: 'localImage', path });
      }
      const started = await this.rpc('thread/start', {
        cwd, baseInstructions: designInstructions, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      });
      threadId = started.thread.id;
      const raw = await this.runTurn(threadId, message);
      const design = checkPhotoScale(validateDesign(JSON.parse(raw)), input);
      return [200, { design }];
    } finally {
      if (threadId && this.child) await this.rpc('thread/unsubscribe', { threadId }, 1500).catch(() => {});
      await rm(cwd, { recursive: true, force: true });
    }
  }

  async runTurn(threadId, input) {
    const messages = [];
    const completions = new Map();
    let settle;
    const completed = new Promise((resolve, reject) => {
      settle = (error, value) => error ? reject(error) : resolve(value);
    });
    completed.catch(() => {});
    let expected;
    const timer = setTimeout(() => settle(new Error('ChatGPT did not complete the design.')), 70_000);
    const item = value => {
      if (value?.threadId === threadId && value.item?.type === 'agentMessage') messages.push(value);
    };
    const finish = value => {
      if (value?.threadId !== threadId || !value.turn?.id) return;
      completions.set(value.turn.id, value.turn);
      if (value.turn.id === expected) settle(null, value.turn);
    };
    const stopped = () => settle(new Error('Codex disconnected.'));
    this.events.on('item/completed', item);
    this.events.on('turn/completed', finish);
    this.events.on('stopped', stopped);
    try {
      const started = await this.rpc('turn/start', {
        threadId, input, outputSchema: designSchema, effort: 'low',
      });
      expected = started.turn.id;
      if (completions.has(expected)) settle(null, completions.get(expected));
      const final = await completed;
      if (final.status !== 'completed') throw new Error('ChatGPT did not complete the design.');
      const candidates = [...(final.items ?? []), ...messages.filter(v => v.turnId === expected).map(v => v.item)]
        .filter(value => value.type === 'agentMessage' && value.phase !== 'commentary' && value.text);
      const output = candidates.findLast(value => value.phase === 'final_answer') ?? candidates.at(-1);
      if (!output) throw new Error('ChatGPT returned no model.');
      return output.text;
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      clearTimeout(timer);
      this.events.off('item/completed', item);
      this.events.off('turn/completed', finish);
      this.events.off('stopped', stopped);
    }
  }
}
