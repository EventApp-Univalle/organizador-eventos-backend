const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';
process.env.DEMO_USER_ID ||= '00000000-0000-4000-8000-000000000001';
process.env.CORS_ORIGINS ||= 'http://localhost:5173';

const scenario = {};
const calls = {};

function resetScenario() {
  scenario.subtasks = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Confirmar sonido',
      target_date: '2026-10-10',
      estimated_hours: '1.5',
      events: {
        title: 'Encuentro cultural',
        is_priority: true,
        owner_id: process.env.DEMO_USER_ID,
      },
    },
  ];
  scenario.events = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Encuentro cultural',
      date: '2026-10-10',
      is_priority: true,
      owner_id: process.env.DEMO_USER_ID,
    },
  ];
  scenario.error = null;
  calls.filters = [];
  calls.orders = [];
}

resetScenario();

const supabaseMock = {
  from(table) {
    const builder = {
      select(fields) {
        calls.select = { table, fields };
        return builder;
      },
      eq(column, value) {
        calls.filters.push({ column, value });
        return builder;
      },
      order(column, options) {
        calls.orders.push({ column, options });
        return builder;
      },
      then(resolve, reject) {
        const data = table === 'events' ? scenario.events : scenario.subtasks;
        return Promise.resolve({
          data,
          error: scenario.error,
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

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json();
  return { response, body };
}

test('GET /api/tareas/hoy devuelve tareas del usuario demo mapeadas', async () => {
  const { response, body } = await request('/api/tareas/hoy');

  assert.equal(response.status, 200);
  assert.deepEqual(body, [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Confirmar sonido',
      date: '2026-10-10',
      estimatedHours: 1.5,
      eventTitle: 'Encuentro cultural',
      priority: 'Alta',
    },
  ]);
  assert.deepEqual(calls.filters, [
    {
      column: 'owner_id',
      value: process.env.DEMO_USER_ID,
    },
    {
      column: 'events.owner_id',
      value: process.env.DEMO_USER_ID,
    },
  ]);
});

test('GET /api/tareas/hoy incluye eventos sin subtareas', async () => {
  scenario.subtasks = [];
  scenario.events = [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: 'Feria de emprendimiento',
      date: '2026-10-12',
      is_priority: false,
      owner_id: process.env.DEMO_USER_ID,
    },
  ];

  const { response, body } = await request('/api/tareas/hoy');

  assert.equal(response.status, 200);
  assert.deepEqual(body, [
    {
      id: 'event-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: 'Feria de emprendimiento',
      date: '2026-10-12',
      estimatedHours: 0,
      eventTitle: 'Feria de emprendimiento',
      priority: 'Media',
    },
  ]);
});

test('GET /api/tareas/hoy oculta los detalles de un error de datos', async () => {
  scenario.error = new Error('detalle interno');

  const { response, body } = await request('/api/tareas/hoy');

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'No fue posible cargar las tareas de Hoy.',
    },
  });
});
