import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import relay from '../api/telegram-webhook.js';

const nativeFetch = globalThis.fetch;
const originalError = console.error;
const keys = ['TELEGRAM_WEBHOOK_SECRET', 'APPS_SCRIPT_WEBHOOK_URL', 'APPS_SCRIPT_WEBHOOK_SECRET'];
let previous, logs;
const payload = '{ "update_id": 7, "message": {"text":"private-message", "chat":{"id":123}} }';
function request(method = 'POST', secret = 'fixture-telegram', body = payload) {
  return new Request('https://relay.example/api/telegram-webhook', {
    method, headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body } : {})
  });
}
beforeEach(() => {
  previous = keys.map(k => process.env[k]); logs = [];
  process.env.TELEGRAM_WEBHOOK_SECRET = 'fixture-telegram';
  process.env.APPS_SCRIPT_WEBHOOK_URL = 'https://script.google.com/macros/s/fixture/exec?existing=yes&token=old';
  process.env.APPS_SCRIPT_WEBHOOK_SECRET = 'fixture-apps&=?secret';
  console.error = (...args) => logs.push(args.join(' '));
  globalThis.fetch = () => { throw new Error('Unexpected network attempt'); };
});
afterEach(() => {
  keys.forEach((k, i) => previous[i] === undefined ? delete process.env[k] : process.env[k] = previous[i]);
  globalThis.fetch = nativeFetch; console.error = originalError;
});
test('GET returns the health response without upstream calls', async () => {
  const response = await relay.fetch(request('GET'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'MCR EV Planner Telegram Relay' });
});
test('wrong or missing configured Telegram secret returns 401', async () => {
  assert.equal((await relay.fetch(request('POST', 'wrong'))).status, 401);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal((await relay.fetch(request())).status, 401);
});
test('valid POST forwards exact JSON with safe query encoding and returns 200', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url.searchParams.get('token'), 'fixture-apps&=?secret');
    assert.equal(url.searchParams.getAll('token').length, 1);
    assert.equal(url.searchParams.get('existing'), 'yes');
    assert.equal(options.method, 'POST'); assert.equal(options.body, payload);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.equal(options.redirect, 'follow'); assert.ok(options.signal instanceof AbortSignal);
    return new Response('OK');
  };
  const response = await relay.fetch(request());
  assert.equal(calls, 1); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
test('native fetch follows 302 internally and Telegram never receives Location', async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ path: req.url, method: req.method, body });
    if (req.url === '/start') { res.writeHead(302, { Location: '/content' }); res.end(); }
    else { res.writeHead(200); res.end('OK'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    globalThis.fetch = (_url, options) => nativeFetch(`http://127.0.0.1:${server.address().port}/start`, options);
    const response = await relay.fetch(request());
    assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
    assert.deepEqual(seen, [{ path: '/start', method: 'POST', body: payload }, { path: '/content', method: 'GET', body: '' }]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('HTTP and connection failures return 502 without exposing upstream secrets', async () => {
  for (const failsByThrowing of [false, true]) {
    globalThis.fetch = async () => {
      if (failsByThrowing) throw new Error('fixture-telegram fixture-apps private-message 123');
      return new Response('fixture-telegram fixture-apps private-message 123', { status: 500 });
    };
    const response = await relay.fetch(request());
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /fixture|private-message|123/);
  }
  assert.deepEqual(logs, ['Relay forwarding failed', 'Relay forwarding failed']);
});
test('invalid configuration and malformed JSON are safely rejected', async () => {
  assert.equal((await relay.fetch(request('POST', 'fixture-telegram', '{'))).status, 400);
  delete process.env.APPS_SCRIPT_WEBHOOK_SECRET;
  const response = await relay.fetch(request());
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /fixture|script.google/);
});
test('other methods return 405', async () => {
  assert.equal((await relay.fetch(request('DELETE'))).status, 405);
});
