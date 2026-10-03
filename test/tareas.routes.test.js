const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const EMPTY = '44444444-4444-4444-8444-444444444444';
const MISSING = '55555555-5555-4555-8555-555555555555';
const referenceDate = '2026-10-02';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let events;
let rows;
let queryError;
let corrupt;
let calls;
function reset() {
  events = [
    { id: E1, owner_id: A, title: 'Evento A1' },
    { id: E2, owner_id: A, title: 'Evento A2' },
    { id: FOREIGN, owner_id: B, title: 'Privado B' },
    { id: EMPTY, owner_id: A, title: 'Vacío A' },
  ];
  rows = [
    { id: id(5), event_id: E1, title: 'Mañana', target_date: '2026-10-03', estimated_hours: '1.5' },
    { id: id(4), event_id: E1, title: 'Hoy largo', target_date: referenceDate, estimated_hours: '3' },
    { id: id(3), event_id: E2, title: 'Hoy breve B', target_date: referenceDate, estimated_hours: '1' },
    { id: id(2), event_id: E1, title: 'Hoy breve A', target_date: referenceDate, estimated_hours: '1' },
    { id: id(1), event_id: E1, title: 'Vencida', target_date: '2026-10-01', estimated_hours: '2' },
    { id: id(6), event_id: FOREIGN, title: 'Secreto B', target_date: referenceDate, estimated_hours: '0.5' },
  ];
  queryError = null;
  corrupt = false;
  calls = [];
}

const supabaseMock = {
  auth: {
    async getUser(token) {
      return token === 'test-a'
        ? { data: { user: { id: A } }, error: null }
        : { data: { user: null }, error: { status: 401 } };
    },
  },
  from(table) {
    const call = { table, filters: {} };
    calls.push(call);
    const builder = {
      select(columns, options) { call.columns = columns; call.options = options; return builder; },
      eq(column, value) { call.filters[column] = value; return builder; },
      order(column, options) { call.order = { column, options }; return builder; },
      async maybeSingle() {
        return {
          data: events.find(e => e.id === call.filters.id && e.owner_id === call.filters.owner_id) || null,
          error: queryError,
        };
      },
      async range(start, end) {
        call.range = [start, end];
        const selected = rows.map(row => ({ ...row, event: events.find(e => e.id === row.event_id) }))
          .filter(row => row.event?.owner_id === call.filters['event.owner_id'])
          .filter(row => !call.filters.event_id || row.event_id === call.filters.event_id)
          .sort((a, b) => a.id.localeCompare(b.id));
        // Emulate a server page limit below the requested range.
        const data = selected.slice(start, Math.min(end + 1, start + 2));
        if (corrupt && data[0]) data[0].estimated_hours = null;
        return { data, count: selected.length, error: queryError };
      },
    };
    return builder;
  },
};
const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: supabaseMock };
const utilsPath = require.resolve('../src/tareas.utils');
const utils = require(utilsPath);
require.cache[utilsPath].exports = { ...utils, getBogotaDate: () => referenceDate };
const app = require('../src/app');
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(reset);
async function request(query = '', authorization = 'Bearer test-a') {
  const response = await fetch(`${base}/api/tareas/hoy${query}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });
  return { status: response.status, body: await response.json() };
}
function flat(body) { return [...body.overdue, ...body.today, ...body.upcoming]; }

test('Hoy requiere autenticación', async () => {
  const result = await request('', null);
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'AUTH_REQUIRED');
  assert.equal(calls.length, 0);
});

test('Hoy rechaza token inválido', async () => {
  const result = await request('', 'Bearer invalid-test');
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'INVALID_TOKEN');
  assert.equal(calls.length, 0);
});

test('solo obtiene subtareas propias, sin datos internos ni prioridad', async () => {
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(flat(result.body).length, 5);
  assert.equal(flat(result.body).some(t => t.eventId === FOREIGN), false);
  assert.ok(calls.every(c => c.filters['event.owner_id'] === A));
  for (const task of flat(result.body)) {
    assert.deepEqual(Object.keys(task).sort(), ['estimatedHours', 'eventId', 'eventTitle', 'id', 'targetDate', 'title']);
    assert.equal(typeof task.estimatedHours, 'number');
    assert.ok(task.eventTitle.startsWith('Evento A'));
  }
});

test('respuesta incluye referencia y clasificación correcta', async () => {
  const { body } = await request();
  assert.deepEqual(Object.keys(body).sort(), ['overdue', 'referenceDate', 'today', 'upcoming']);
  assert.equal(body.referenceDate, referenceDate);
  assert.deepEqual(body.overdue.map(t => t.id), [id(1)]);
  assert.deepEqual(body.today.map(t => t.id), [id(2), id(3), id(4)]);
  assert.deepEqual(body.upcoming.map(t => t.id), [id(5)]);
});

test('orden fecha, esfuerzo e id se cumple dentro de cada grupo', async () => {
  rows.push(
    { id: id(7), event_id: E1, title: 'Anterior breve', target_date: '2026-09-30', estimated_hours: 1 },
    { id: id(8), event_id: E1, title: 'Anterior largo', target_date: '2026-09-30', estimated_hours: 5 },
    { id: id(9), event_id: E1, title: 'Posterior breve', target_date: '2026-10-04', estimated_hours: 0.5 }
  );
  const { body } = await request();
  assert.deepEqual(body.overdue.map(t => t.id), [id(7), id(8), id(1)]);
  assert.deepEqual(body.today.map(t => t.id), [id(2), id(3), id(4)]);
  assert.deepEqual(body.upcoming.map(t => t.id), [id(5), id(9)]);
});

test('eventId propio filtra después de comprobar propiedad', async () => {
  const result = await request(`?eventId=${E2}`);
  assert.equal(result.status, 200);
  assert.deepEqual(flat(result.body).map(t => t.id), [id(3)]);
  assert.deepEqual(calls[0].filters, { id: E2, owner_id: A });
  assert.equal(calls[1].filters.event_id, E2);
  assert.equal(calls[1].filters['event.owner_id'], A);
});

test('eventId ajeno devuelve 404 sin consultar subtareas', async () => {
  const result = await request(`?eventId=${FOREIGN}`);
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'EVENT_NOT_FOUND');
  assert.equal(calls.length, 1);
});

test('eventId inexistente devuelve el mismo 404 que uno ajeno', async () => {
  const foreign = await request(`?eventId=${FOREIGN}`);
  const missing = await request(`?eventId=${MISSING}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing, foreign);
});

test('UUID inválido o vacío devuelve 400', async () => {
  for (const query of ['?eventId=invalido', '?eventId=']) {
    const result = await request(query);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(calls.length, 0);
});

test('eventId repetido devuelve 400 aunque ambos valores sean iguales', async () => {
  const result = await request(`?eventId=${E1}&eventId=${E1}`);
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  assert.equal(calls.length, 0);
});

test('todos los filtros desconocidos se rechazan con 400', async () => {
  for (const key of ['userId', 'ownerId', 'status', 'priority', 'eventId[]', 'otro']) {
    const result = await request(`?${encodeURIComponent(key)}=valor`);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(calls.length, 0);
});

test('evento propio sin subtareas devuelve 200 con tres grupos vacíos', async () => {
  const result = await request(`?eventId=${EMPTY}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { referenceDate, overdue: [], today: [], upcoming: [] });
});

test('usuario sin eventos recibe tres grupos vacíos', async () => {
  events = [];
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { referenceDate, overdue: [], today: [], upcoming: [] });
});

test('errores consultando eventos o subtareas devuelven 500 controlado', async () => {
  queryError = { message: 'detalle interno privado' };
  for (const query of ['', `?eventId=${E1}`]) {
    const result = await request(query);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: { code: 'INTERNAL_ERROR', message: 'No fue posible completar la operación.' } });
  }
});

test('datos inconsistentes devuelven 500 y nunca éxito parcial', async () => {
  corrupt = true;
  const result = await request();
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
});

test('paginación interna recupera todas las subtareas sin truncarlas', async () => {
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(flat(result.body).length, 5);
  assert.deepEqual(calls.map(c => c.range[0]), [0, 2, 4]);
  assert.ok(calls.every(c => c.options.count === 'exact'));
});

test('próximas incluye fechas lejanas, sin ventana de siete días', async () => {
  rows.push({ id: id(10), event_id: E1, title: 'Futura', target_date: '2027-05-01', estimated_hours: 2 });
  const { body } = await request();
  assert.deepEqual(body.upcoming.map(t => t.id), [id(5), id(10)]);
});
