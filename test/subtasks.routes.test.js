const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';
process.env.DEMO_USER_ID ||= '00000000-0000-4000-8000-000000000001';
process.env.CORS_ORIGINS ||= 'http://localhost:5173';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBTASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const scenario = {};
const calls = {};

function resetScenario() {
  scenario.event = { id: EVENT_ID };
  scenario.eventError = null;
  scenario.insertedSubtask = {
    id: SUBTASK_ID,
    event_id: EVENT_ID,
    title: 'Confirmar sonido',
    target_date: '2026-10-10',
    estimated_hours: '1.5',
    created_at: '2026-09-26T05:00:00.000Z',
  };
  scenario.insertError = null;
  scenario.subtasks = [];
  scenario.listError = null;

  calls.filters = [];
  calls.orders = [];
  calls.insert = null;
}

resetScenario();

const supabaseMock = {
  from(table) {
    const builder = {
      select() {
        return builder;
      },
      eq(column, value) {
        calls.filters.push({ table, column, value });
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({
          data: scenario.event,
          error: scenario.eventError,
        });
      },
      insert(value) {
        calls.insert = { table, value };
        return builder;
      },
      single() {
        return Promise.resolve({
          data: scenario.insertedSubtask,
          error: scenario.insertError,
        });
      },
      order(column, options) {
        calls.orders.push({ table, column, options });
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve({
          data: scenario.subtasks,
          error: scenario.listError,
        }).then(resolve, reject);
      },
    };

    return builder;
  },
};

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: supabaseMock,
};

const app = require('../src/app');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  resetScenario();
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test('POST rechaza UUID inválido con VALIDATION_ERROR', async () => {
  const { response, body } = await request('/api/eventos/no-es-uuid/subtareas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Confirmar sonido',
      targetDate: '2026-10-10',
      estimatedHours: 1.5,
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.fields.id, 'Debe ser un UUID válido.');
  assert.equal(calls.filters.length, 0);
});

test('POST rechaza campos desconocidos antes de consultar el evento', async () => {
  const { response, body } = await request(
    `/api/eventos/${EVENT_ID}/subtareas`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Confirmar sonido',
        targetDate: '2026-10-10',
        estimatedHours: 1.5,
        eventId: EVENT_ID,
      }),
    }
  );

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.fields.eventId, 'Campo no permitido.');
  assert.equal(calls.filters.length, 0);
});

test('POST devuelve 404 cuando el evento no pertenece al usuario demo', async () => {
  scenario.event = null;

  const { response, body } = await request(
    `/api/eventos/${EVENT_ID}/subtareas`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Confirmar sonido',
        targetDate: '2026-10-10',
        estimatedHours: 1.5,
      }),
    }
  );

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'EVENT_NOT_FOUND');
  assert.equal(calls.insert, null);
  assert.deepEqual(calls.filters, [
    { table: 'events', column: 'id', value: EVENT_ID },
    {
      table: 'events',
      column: 'owner_id',
      value: process.env.DEMO_USER_ID,
    },
  ]);
});

test('POST persiste y devuelve la subtarea mapeada con 201', async () => {
  const { response, body } = await request(
    `/api/eventos/${EVENT_ID}/subtareas`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '  Confirmar sonido  ',
        targetDate: '2026-10-10',
        estimatedHours: 1.5,
      }),
    }
  );

  assert.equal(response.status, 201);
  assert.deepEqual(calls.insert, {
    table: 'subtasks',
    value: {
      event_id: EVENT_ID,
      title: 'Confirmar sonido',
      target_date: '2026-10-10',
      estimated_hours: 1.5,
    },
  });
  assert.deepEqual(body, {
    id: SUBTASK_ID,
    eventId: EVENT_ID,
    title: 'Confirmar sonido',
    targetDate: '2026-10-10',
    estimatedHours: 1.5,
    createdAt: '2026-09-26T05:00:00.000Z',
  });
});

test('GET devuelve 200 y [] cuando el evento existe sin subtareas', async () => {
  const { response, body } = await request(
    `/api/eventos/${EVENT_ID}/subtareas`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(body, []);
  assert.deepEqual(calls.orders, [
    {
      table: 'subtasks',
      column: 'created_at',
      options: { ascending: true },
    },
    {
      table: 'subtasks',
      column: 'id',
      options: { ascending: true },
    },
  ]);
});

test('GET devuelve subtareas mapeadas', async () => {
  scenario.subtasks = [scenario.insertedSubtask];

  const { response, body } = await request(
    `/api/eventos/${EVENT_ID}/subtareas`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(body, [
    {
      id: SUBTASK_ID,
      eventId: EVENT_ID,
      title: 'Confirmar sonido',
      targetDate: '2026-10-10',
      estimatedHours: 1.5,
      createdAt: '2026-09-26T05:00:00.000Z',
    },
  ]);
});

test('JSON mal formado devuelve 400 INVALID_JSON', async () => {
  const { response, body } = await request('/api/eventos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"title":',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    error: {
      code: 'INVALID_JSON',
      message: 'El cuerpo debe ser JSON válido.',
    },
  });
});

test('una ruta inexistente devuelve 404 ROUTE_NOT_FOUND', async () => {
  const { response, body } = await request('/api/no-existe');

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
});

test('un error de datos devuelve 500 sin detalles internos', async () => {
  scenario.listError = { message: 'detalle interno que no debe exponerse' };

  const { response, body } = await request(
    `/api/eventos/${EVENT_ID}/subtareas`
  );

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'No fue posible completar la operación.',
    },
  });
  assert.equal(JSON.stringify(body).includes('detalle interno'), false);
});
