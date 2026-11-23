import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readDesignInput } from '../src/design-input.js';

const cookieName = '__Host-printlab-owner';
const maxAge = 30 * 24 * 60 * 60;
const cookie = (value, age) => `${cookieName}=${value}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=Strict`;
const signature = (body, secret) => createHmac('sha256', secret).update('printlab-owner:' + body).digest('base64url');

function matches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function ownerSession(header, secret, now) {
  const token = typeof header === 'string' && header.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const match = token && /^(\d{1,12}\.[\w-]{22})\.([\w-]{43})$/.exec(token);
  if (!match) return false;
  return Number(match[1].split('.')[0]) > now && matches(match[2], signature(match[1], secret));
}

export async function handleSubscription(request, { secret, now = Math.floor(Date.now() / 1000), call } = {}) {
  const { method, body, headers } = request;
  if (!['GET', 'POST'].includes(method)) return { status: 405, payload: { error: 'Method unavailable.' } };
  if (method === 'GET' && (!secret || !ownerSession(headers.cookie, secret, now))) {
    return { status: 200, payload: { available: Boolean(secret), owner: false } };
  }
  if (!secret) return { status: 503, payload: { error: 'ChatGPT subscription sign-in is unavailable on this deployment.' } };
  if (method === 'POST' && (headers.origin !== 'https://' + headers.host ||
      !headers['content-type']?.startsWith('application/json'))) {
    return { status: 403, payload: { error: 'Open PrintLab directly and retry.' } };
  }
  const action = method === 'GET' ? 'status' : body?.action;
  if (action === 'unlock') {
    if (!matches(body.code, secret)) return { status: 401, payload: { error: 'The PrintLab owner code is incorrect.' } };
    const record = `${now + maxAge}.${randomBytes(16).toString('base64url')}`;
    return {
      status: 200, payload: { available: true, owner: true, connected: false },
      setCookie: cookie(record + '.' + signature(record, secret), maxAge),
    };
  }
  if (!ownerSession(headers.cookie, secret, now)) return { status: 401, payload: { error: 'Unlock owner access in AI settings first.' } };
  if (action === 'lock') {
    return { status: 200, payload: { available: true, owner: false }, setCookie: cookie('', 0) };
  }
  const allowed = method === 'GET' ? ['status'] : ['connect', 'cancel', 'disconnect', 'generate'];
  if (!allowed.includes(action)) return { status: 400, payload: { error: 'Unknown ChatGPT action.' } };
  let input;
  if (action === 'generate') {
    try { input = readDesignInput(body.input); }
    catch (error) { return { status: 400, payload: { error: error.message } }; }
  }
  try {
    const result = await call(action, input);
    return {
      status: result.status,
      payload: result.status === 200 && action !== 'generate'
        ? { ...result.payload, available: true, owner: true } : result.payload,
    };
  } catch (error) {
    console.warn('PrintLab subscription worker unavailable', { action, stage: error?.stage, kind: error?.code ?? error?.name, status: error?.status, detail: error?.detail, message: error?.message?.startsWith('The ChatGPT worker') ? error.message : undefined });
    return { status: 503, payload: { error: 'The ChatGPT worker is temporarily unavailable. Try again in a moment.' } };
  }
}

