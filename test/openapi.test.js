const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret-key';

const app = require('../src/app');
const openapiPath = path.join(__dirname, '..', 'docs', 'openapi.json');
const document = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));

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

test('openapi.json es JSON válido y solo documenta las rutas de Sprint 1 y 2', () => {
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
  assert.match(html, /EventApp API - Sprint 2/);
});

test('OpenAPI define Bearer JWT y protege todas las operaciones privadas', () => {
  const scheme = document.components.securitySchemes.BearerAuth;
  assert.equal(scheme.type, 'http');
  assert.equal(scheme.scheme, 'bearer');
  assert.equal(scheme.bearerFormat, 'JWT');
  for (const [route, operations] of Object.entries(document.paths)) {
    for (const operation of Object.values(operations)) {
      if (route === '/health') {
        assert.deepEqual(operation.security, []);
      } else {
        assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
        assert.deepEqual(operation.responses['401'], { $ref: '#/components/responses/Unauthorized' });
      }
    }
  }
});

test('Hoy documenta únicamente eventId y los cinco estados HTTP aprobados', () => {
  const hoy = document.paths['/api/tareas/hoy'].get;
  assert.deepEqual(hoy.parameters.map(p => p.name), ['eventId']);
  assert.equal(hoy.parameters[0].in, 'query');
  assert.equal(hoy.parameters[0].required, false);
  assert.equal(hoy.parameters[0].schema.format, 'uuid');
  assert.deepEqual(Object.keys(hoy.responses).sort(), ['200', '400', '401', '404', '500']);
  const response = document.components.schemas.TodayResponse;
  assert.deepEqual(response.required, ['referenceDate', 'overdue', 'today', 'upcoming']);
  for (const group of ['overdue', 'today', 'upcoming']) {
    assert.equal(response.properties[group].type, 'array');
    assert.equal(response.properties[group].items.$ref, '#/components/schemas/TodayTask');
  }
  assert.deepEqual(document.components.schemas.TodayTask.required,
    ['id', 'title', 'eventId', 'eventTitle', 'targetDate', 'estimatedHours']);
});

test('ejemplos de autenticación coinciden con respuestas del middleware', async () => {
  const examples = document.components.responses.Unauthorized.content['application/json'].examples;
  for (const [key, authorization] of [['authRequired', null], ['invalidToken', 'Basic invalid-test']]) {
    const response = await fetch(`${baseUrl}/api/tareas/hoy`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), examples[key].value);
  }
});

test('todas las referencias internas de OpenAPI tienen destino', () => {
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'));
      const target = value.$ref.slice(2).split('/').reduce((current, key) => current?.[key], document);
      assert.ok(target, `Referencia inexistente: ${value.$ref}`);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(document);
});
