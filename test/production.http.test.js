const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
process.env.CORS_ORIGINS = 'https://miniproyecto1-front-wine.vercel.app';
process.env.NODE_ENV = 'production';
process.env.DOTENV_CONFIG_QUIET = 'true';
const sdk = require.resolve('../src/supabase');
require.cache[sdk] = { id: sdk, filename: sdk, loaded: true, exports: {
  auth: { async getUser() { return { data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }; } },
  from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: { message: 'PRIVATE_TEST_SENTINEL' } }; } }; },
} };
const app = require('../src/app');
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('preflight privado autoriza el frontend exacto con Authorization y JSON', async () => {
  const res = await fetch(`${base}/api/eventos`, { method: 'OPTIONS', headers: {
    Origin: process.env.CORS_ORIGINS, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type',
  } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), process.env.CORS_ORIGINS);
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
});
test('origen ajeno no recibe permiso CORS ni datos; sin token permanece 401', async () => {
  const res = await fetch(`${base}/api/eventos`, { headers: { Origin: 'https://otro.test' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.status, 401); assert.equal((await res.json()).error.code, 'AUTH_REQUIRED');
});
test('health no publica X-Powered-By y fallo técnico no divulga mensajes internos en JSON ni logs', async () => {
  const health = await fetch(`${base}/health`); assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-powered-by'), null);
  const log = mock.method(console, 'error', () => {});
  try {
    const res = await fetch(`${base}/api/eventos/00000000-0000-4000-8000-000000000002`, { headers: { Authorization: 'Bearer test-only-token' } });
    assert.equal(res.status, 500); assert.equal((await res.json()).error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(log.mock.calls.map(call => call.arguments)).includes('PRIVATE_TEST_SENTINEL'), false);
  } finally { log.mock.restore(); }
});
