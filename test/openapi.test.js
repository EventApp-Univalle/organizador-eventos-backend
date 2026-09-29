const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret-key';
process.env.DEMO_USER_ID ||= '00000000-0000-4000-8000-000000000001';

const app = require('../src/app');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('openapi.json es JSON válido y documenta las rutas actuales', () => {
  const openapiPath = path.join(__dirname, '..', 'docs', 'openapi.json');
  const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));

  assert.match(openapi.openapi, /^3\./);
  assert.deepEqual(Object.keys(openapi.paths).sort(), [
    '/api/eventos',
    '/api/eventos/{id}',
    '/api/eventos/{id}/subtareas',
    '/api/tareas/hoy',
    '/health',
  ]);
  assert.ok(openapi.paths['/health'].get);
  assert.ok(openapi.paths['/api/eventos'].post);
  assert.ok(openapi.paths['/api/eventos/{id}'].get);
  assert.ok(openapi.paths['/api/eventos/{id}/subtareas'].post);
  assert.ok(openapi.paths['/api/eventos/{id}/subtareas'].get);
  assert.ok(openapi.paths['/api/tareas/hoy'].get);
});

test('Swagger UI responde en /api-docs', async () => {
  const response = await fetch(`${baseUrl}/api-docs/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(html, /id="swagger-ui"/);
  assert.match(html, /EventApp API - Sprint 1/);
});
