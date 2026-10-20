const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtimeSettings } = require('../src/environment.utils');
const document = require('../docs/openapi.json');
test('producción exige CORS explícito y valida PORT', () => {
  assert.throws(() => runtimeSettings({ NODE_ENV: 'production' }), /CORS_ORIGINS/);
  for (const PORT of ['0', '-1', '99999', 'texto', '1.5']) assert.throws(() => runtimeSettings({ PORT }), /PORT/);
  assert.equal(runtimeSettings({ PORT: '10000' }).port, 10000);
});
test('CORS solo acepta orígenes exactos, sin comodines, rutas ni credenciales', () => {
  for (const origin of ['*', 'null', 'https://site.test/path', 'https://user:password@site.test', 'http://site.test']) {
    assert.throws(() => runtimeSettings({ NODE_ENV: 'production', CORS_ORIGINS: origin }));
  }
  assert.deepEqual(runtimeSettings({ NODE_ENV: 'production', CORS_ORIGINS: 'https://miniproyecto1-front-wine.vercel.app,https://miniproyecto1-front-wine.vercel.app/' }).corsOrigins, ['https://miniproyecto1-front-wine.vercel.app']);
});
test('desarrollo conserva localhost y producción no refleja cualquier origen', () => {
  assert.deepEqual(runtimeSettings({}).corsOrigins, ['http://localhost:5173']);
  assert.deepEqual(runtimeSettings({ NODE_ENV: 'production', CORS_ORIGINS: 'http://localhost:5173' }).corsOrigins, ['http://localhost:5173']);
  const list = runtimeSettings({ NODE_ENV: 'production', CORS_ORIGINS: 'https://miniproyecto1-front-wine.vercel.app' }).corsOrigins;
  assert.equal(list.includes('https://otro.test'), false);
});
test('Swagger conserva Render real y localhost para Try it out', () => {
  assert.deepEqual(document.servers.map(server => server.url), ['https://eventapp-univalle-backend.onrender.com', 'http://localhost:3000']);
});
