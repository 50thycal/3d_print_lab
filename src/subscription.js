const $ = id => document.getElementById(id);

export function subscriptionUI({ onChange }) {
  let state = {};
  let revision = 0;
  let busy = false;
  let poll;
  const feedback = $('subscription-status');
  const panel = $('settings');

  function status(message, error = false) {
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.classList.toggle('error', error);
  }

  function draw() {
    $('owner-form').hidden = !state.available || state.owner;
    $('subscription-actions').hidden = !state.owner;
    $('subscription-connect').hidden = Boolean(state.connected || state.login);
    $('subscription-disconnect').hidden = !state.connected;
    $('device-login').hidden = !state.login;
    $('device-code').textContent = state.login?.code || '';
    for (const button of document.querySelectorAll('.subscription-settings button')) button.disabled = busy;
    clearTimeout(poll);
    if (state.login && panel.open && !busy) poll = setTimeout(() => refresh(true), 4500);
    onChange(state);
  }

  async function api(action, payload) {
    const options = action ? {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    } : { credentials: 'same-origin', cache: 'no-store' };
    const response = await fetch('/api/subscription', options);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || 'ChatGPT sign-in is temporarily unavailable.');
    return data;
  }

  function report() {
    if (state.connected) return status('ChatGPT connected' + (state.plan ? ' · ' + state.plan : ''));
    if (state.login) return status('Waiting for approval on OpenAI.');
    if (state.loginFailed) return status('Sign-in expired or was declined. Start a new sign-in.', true);
    if (!state.available) return status('ChatGPT subscription sign-in is unavailable on this deployment.');
    return status('');
  }

  async function refresh(background = false) {
    if (busy) return;
    const attempt = ++revision;
    try {
      const next = await api();
      if (attempt !== revision) return;
      state = next;
      report();
    } catch (error) {
      if (attempt === revision && !background) status(error.message, true);
    } finally {
      if (attempt === revision) draw();
    }
  }

  async function perform(action, payload) {
    if (busy) return;
    const attempt = ++revision;
    busy = true;
    draw();
    status({
      unlock: 'Checking owner access…', connect: 'Starting OpenAI sign-in…',
      cancel: 'Canceling sign-in…', disconnect: 'Disconnecting ChatGPT…', lock: 'Locking browser…',
    }[action]);
    try {
      state = await api(action, payload);
      report();
    } catch (error) {
      status(error.message, true);
    } finally {
      busy = false;
      draw();
      if (action === 'unlock' && state.owner && attempt === revision) void refresh();
    }
  }

  $('owner-form').addEventListener('submit', event => {
    event.preventDefault();
    const field = $('owner-code');
    const code = field.value.trim();
    field.value = '';
    if (code) void perform('unlock', { code });
  });
  $('subscription-connect').addEventListener('click', () => perform('connect'));
  $('cancel-device-login').addEventListener('click', () => perform('cancel'));
  $('subscription-disconnect').addEventListener('click', () => perform('disconnect'));
  $('subscription-lock').addEventListener('click', () => perform('lock'));
  $('copy-device-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.login.code);
      status('Code copied. Open OpenAI sign-in to enter it.');
    } catch {
      status('Select and copy the code shown above.');
    }
  });
  panel.addEventListener('close', () => clearTimeout(poll));
  document.addEventListener('visibilitychange', () => {
    if (panel.open && !document.hidden && state.login) void refresh(true);
  });
  void refresh();

  return {
    open: () => refresh(),
    connected: () => Boolean(state.connected),
    generate: async input => {
      try {
        return await api('generate', { input });
      } catch (error) {
        void refresh(true);
        throw error;
      }
    },
  };
}
