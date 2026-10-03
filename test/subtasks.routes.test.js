const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';
process.env.CORS_ORIGINS ||= 'http://localhost:5173';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBTASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const REFERENCE_DATE = '2026-10-03';
mock.method(require('../src/tareas.utils'), 'getBogotaDate', () => REFERENCE_DATE);

const scenario = {};
const calls = {};

function resetScenario() {
  scenario.event = { id: EVENT_ID, date: '2026-10-15' };
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
  auth: {
    async getUser() {
      return { data: { user: { id: USER_ID } }, error: null };
    },
  },
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
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: 'Bearer test-user', ...options.headers },
  });
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

test('POST devuelve 404 cuando el evento no pertenece al usuario autenticado', async () => {
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
      value: USER_ID,
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

async function postSubtask(overrides = {}) {
  return request(`/api/eventos/${EVENT_ID}/subtareas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Sonido', targetDate: '2026-10-10', estimatedHours: 1.5, ...overrides }),
  });
}

for (const [label, targetDate] of [
  ['hoy', REFERENCE_DATE],
  ['fecha del evento', '2026-10-15'],
  ['fecha intermedia', '2026-10-10'],
]) {
  test(`POST acepta ${label} y esfuerzo decimal positivo`, async () => {
    scenario.insertedSubtask.target_date = targetDate;
    scenario.insertedSubtask.estimated_hours = '0.5';
    const { response, body } = await postSubtask({ targetDate, estimatedHours: 0.5 });
    assert.equal(response.status, 201);
    assert.equal(calls.insert.value.target_date, targetDate);
    assert.equal(calls.insert.value.estimated_hours, 0.5);
    assert.equal(body.targetDate, targetDate);
    assert.equal(body.estimatedHours, 0.5);
  });
}

for (const [targetDate, message] of [
  ['2026-10-02', 'La fecha no puede ser anterior a hoy.'],
  ['2026-10-16', 'La fecha no puede ser posterior a la fecha del evento.'],
]) {
  test(`POST rechaza fecha fuera del intervalo: ${targetDate}`, async () => {
    const { response, body } = await postSubtask({ targetDate });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.fields.targetDate, message);
    assert.equal(calls.insert, null);
    assert.ok(calls.filters.some(filter => filter.column === 'owner_id' && filter.value === USER_ID));
  });
}

for (const estimatedHours of [0, -1, '1.5']) {
  test(`POST rechaza horas inválidas ${JSON.stringify(estimatedHours)}`, async () => {
    const { response, body } = await postSubtask({ estimatedHours });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.fields.estimatedHours);
    assert.equal(calls.insert, null);
  });
}

test('evento pasado bloquea nueva subtarea sin borrar su historial', async () => {
  scenario.event.date = '2026-10-02';
  const result = await postSubtask({ targetDate: REFERENCE_DATE });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  assert.equal(calls.insert, null);
  scenario.insertedSubtask.target_date = '2026-10-01';
  scenario.subtasks = [scenario.insertedSubtask];
  const listed = await request(`/api/eventos/${EVENT_ID}/subtareas`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body[0].targetDate, '2026-10-01');
});

test('fecha del evento inconsistente devuelve 500 controlado', async () => {
  scenario.event.date = '2026-02-30';
  const { response, body } = await postSubtask();
  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(calls.insert, null);
});
