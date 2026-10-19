(() => {
  const IPC_URL_PREFIX = 'http://ipc.localhost/';
  const CANCEL_COMMAND = 'app_cancel_close';
  const MANAGED_COMMANDS = [
    'app_confirm_close',
    'app_cancel_close',
    'app_hold_close',
  ];
  const gate = { rules: {}, fakes: {}, calls: [], isPostMessageWrapped: false };
  Object.defineProperty(window, '__ipcGate', { value: gate });

  const ruleOf = (command) => gate.rules[command] ?? 'pass';
  const isManaged = (command) => MANAGED_COMMANDS.includes(command);

  function ruleApplied(command, transport) {
    const rule = ruleOf(command);
    gate.calls.push({ command, transport, rule });
    return rule;
  }

  function commandOfRequest(input) {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string') return null;
    return url.startsWith(IPC_URL_PREFIX)
      ? url.slice(IPC_URL_PREFIX.length)
      : null;
  }

  function matchesFake(fake, args) {
    const path = String(args?.path ?? '');
    const isPathMatch = !fake.pathSuffix || path.endsWith(fake.pathSuffix);
    const areArgsMatch = Object.entries(fake.args ?? {}).every(
      ([key, value]) => args?.[key] === value,
    );
    return isPathMatch && areArgsMatch;
  }

  function fakeFor(command, args) {
    const fake = command ? gate.fakes[command] : null;
    return fake && matchesFake(fake, args) ? fake : null;
  }

  function recordFake(command, transport) {
    gate.calls.push({ command, transport, rule: 'fake' });
  }

  function fakeResponse(fake) {
    return new Response(JSON.stringify(fake.body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Tauri-Response': fake.isError ? 'error' : 'ok',
      },
    });
  }

  function swallowedResponse() {
    return new Response('null', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  function wrapFetch() {
    const nativeFetch = window.fetch;
    window.fetch = (input, init) => {
      const command = commandOfRequest(input);
      const fake = fakeFor(command, parseIpcMessage(init?.body));
      if (fake) {
        recordFake(command, 'fetch');
        return Promise.resolve(fakeResponse(fake));
      }
      if (!isManaged(command)) return nativeFetch.call(window, input, init);
      const rule = ruleApplied(command, 'fetch');
      if (rule === 'swallow') return Promise.resolve(swallowedResponse());
      const target =
        rule === 'cancel' ? IPC_URL_PREFIX + CANCEL_COMMAND : input;
      return nativeFetch.call(window, target, init);
    };
  }

  function parseIpcMessage(message) {
    if (typeof message !== 'string') return null;
    try {
      return JSON.parse(message);
    } catch {
      return null;
    }
  }

  function failCallback(errorId) {
    setTimeout(() => window.__TAURI_INTERNALS__.runCallback(errorId, null));
  }

  function succeedCallback(callbackId, body) {
    setTimeout(() => window.__TAURI_INTERNALS__.runCallback(callbackId, body));
  }

  function wrapPostMessage() {
    const webview = window.chrome?.webview;
    if (!webview) return;
    const nativePost = webview.postMessage;
    const wrapper = (message) => {
      const parsed = parseIpcMessage(message);
      const fake = parsed ? fakeFor(parsed.cmd, parsed.payload) : null;
      if (fake) {
        recordFake(parsed.cmd, 'postMessage');
        if (fake.isError) return failCallback(parsed.error);
        return succeedCallback(parsed.callback, fake.body);
      }
      if (!parsed || !isManaged(parsed.cmd)) {
        return nativePost.call(webview, message);
      }
      const rule = ruleApplied(parsed.cmd, 'postMessage');
      if (rule === 'swallow') return failCallback(parsed.error);
      const cancelled = JSON.stringify({ ...parsed, cmd: CANCEL_COMMAND });
      return nativePost.call(webview, rule === 'cancel' ? cancelled : message);
    };
    webview.postMessage = wrapper;
    gate.isPostMessageWrapped = window.chrome.webview.postMessage === wrapper;
  }

  wrapFetch();
  wrapPostMessage();
})();
