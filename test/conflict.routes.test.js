const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';

const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBTASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const scenario = {};

function resetScenario() {
  scenario.event = { id: EVENT_ID, date: '2026-10-15' };
  scenario.subtask = {
    id: SUBTASK_ID,
    event_id: EVENT_ID,
    title: 'Sonido',
    target_date: '2026-10-10',
    estimated_hours: 2,
    created_at: '2026-10-01T12:00:00Z',
  };
  scenario.profile = { daily_capacity_hours: 6 };
  scenario.dayTasks = [];
  scenario.error = null;
}

resetScenario();

function readData(table, selectColumns) {
  if (table === 'events') return scenario.event;
  if (table === 'users') return scenario.profile;
  if (table === 'subtasks') {
    if (selectColumns && String(selectColumns).includes('event:')) return scenario.dayTasks;
    return scenario.subtask;
  }
  return null;
}

const supabaseMock = {
  auth: {
    async getUser() {
      return { data: { user: { id: USER_ID } }, error: null };
    },
  },
  from(table) {
    let operation = 'read';
    let changes;
    let selectColumns;

    return {
      select(columns) { selectColumns = columns; return this; },
      eq() { return this; },
      update(value) { operation = 'update'; changes = value; return this; },
      async maybeSingle() {
        if (scenario.error) return { data: null, error: scenario.error };
        const base = readData(table, selectColumns);
        const data = operation === 'update' && base ? { ...base, ...changes } : base;
        return { data, error: null };
      },
      then(resolve, reject) {
        if (scenario.error) return Promise.resolve({ data: null, error: scenario.error }).then(resolve, reject);
        return Promise.resolve({ data: readData(table, selectColumns), error: null }).then(resolve, reject);
      },
    };
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

beforeEach(resetScenario);

async function patchSubtask(body) {
  const response = await fetch(
    `${baseUrl}/api/eventos/${EVENT_ID}/subtareas/${SUBTASK_ID}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-user',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('reprogramar fecha con sobrecarga devuelve 409 con cifras', async () => {
  scenario.dayTasks = [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', estimated_hours: 5 }];
  const { response, body } = await patchSubtask({ targetDate: '2026-10-12' });
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'DAILY_CAPACITY_EXCEEDED');
  assert.deepEqual(body.error.details, {
    targetDate: '2026-10-12',
    totalHours: 7,
    limitHours: 6,
  });
});

test('aumentar horas en la misma fecha con sobrecarga devuelve 409', async () => {
  scenario.dayTasks = [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', estimated_hours: 5 }];
  const { response, body } = await patchSubtask({ estimatedHours: 2.5 });
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'DAILY_CAPACITY_EXCEEDED');
  assert.equal(body.error.details.totalHours, 7.5);
  assert.equal(body.error.details.limitHours, 6);
});

test('reprogramar dentro del límite guarda con 200', async () => {
  scenario.dayTasks = [];
  const { response, body } = await patchSubtask({ targetDate: '2026-10-12', estimatedHours: 3 });
  assert.equal(response.status, 200);
  assert.equal(body.targetDate, '2026-10-12');
  assert.equal(body.estimatedHours, 3);
});

test('editar solo el título no consulta la capacidad y guarda', async () => {
  const { response, body } = await patchSubtask({ title: 'Nuevo título' });
  assert.equal(response.status, 200);
  assert.equal(body.title, 'Nuevo título');
});

test('la suma excluye la subtarea que se está editando', async () => {
  scenario.dayTasks = [
    { id: SUBTASK_ID, estimated_hours: 2 },
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', estimated_hours: 4 },
  ];
  const { response } = await patchSubtask({ estimatedHours: 2 });
  assert.equal(response.status, 200);
});

test('error al consultar la capacidad devuelve 500 sin detalles', async () => {
  scenario.error = { message: 'detalle privado' };
  const { response, body } = await patchSubtask({ targetDate: '2026-10-12' });
  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(body).includes('detalle privado'), false);
});
