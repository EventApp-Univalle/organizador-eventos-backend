const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');

process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let rows, calls, failure, corrupt, stopEarly;

function reset() {
  rows = [
    { id: id(3), owner_id: A, title: 'Sin subtareas', date: '2026-10-11' },
    { id: id(2), owner_id: A, title: 'Segundo', date: '2026-10-10' },
    { id: id(1), owner_id: A, title: 'Primero', date: '2026-10-10' },
    { id: id(4), owner_id: B, title: 'Privado B', date: '2026-10-09' },
  ].map(row => ({ ...row, type: 'Cultural', time: null, location: null,
    description: null, is_priority: false, created_at: '2026-10-03T12:00:00.000Z' }));
  calls = [];
  failure = corrupt = stopEarly = false;
}

const supabaseMock = {
  auth: {
    async getUser(token) {
      const userId = token === 'test-a' ? A : token === 'test-b' ? B : null;
      return userId ? { data: { user: { id: userId } }, error: null }
        : { data: null, error: { status: 401 } };
    },
  },
  from(table) {
    const call = { table, filters: {}, orders: [] };
    calls.push(call);
    const query = {
      select(columns, options) { call.columns = columns; call.options = options; return query; },
      eq(column, value) { call.filters[column] = value; return query; },
      order(column, options) { call.orders.push({ column, options }); return query; },
      async range(start, end) {
        call.range = [start, end];
        const selected = rows.filter(row => row.owner_id === call.filters.owner_id)
          .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        // A lower server limit forces a second request even for this small fixture.
        const data = stopEarly && start > 0 ? [] : selected.slice(start, Math.min(end + 1, start + 2));
        if (corrupt && data[0]) data[0] = { ...data[0], owner_id: B };
        return { data, count: selected.length, error: failure ? { message: 'private database detail' } : null };
      },
    };
    return query;
  },
};
const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: supabaseMock };
const app = require('../src/app');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(reset);

async function request(token = 'test-a', query = '') {
  const response = await fetch(`${base}/api/eventos${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

test('colección requiere autenticación y rechaza token inválido', async () => {
  for (const [token, code] of [[null, 'AUTH_REQUIRED'], ['invalid', 'INVALID_TOKEN']]) {
    const result = await request(token);
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, code);
  }
  assert.equal(calls.length, 0);
});

test('A recibe únicamente sus eventos y no se expone owner_id', async () => {
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map(row => row.id), [id(1), id(2), id(3)]);
  assert.ok(calls.every(call => call.filters.owner_id === A));
  assert.deepEqual(Object.keys(result.body[0]).sort(),
    ['id', 'title', 'type', 'date', 'time', 'location', 'description', 'isPriority', 'createdAt'].sort());
});

test('B recibe únicamente sus eventos', async () => {
  const result = await request('test-b');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map(row => row.id), [id(4)]);
  assert.ok(calls.every(call => call.filters.owner_id === B));
});

test('incluye eventos sin subtareas sin consultar otra tabla', async () => {
  const { body } = await request();
  assert.ok(body.some(row => row.title === 'Sin subtareas'));
  assert.ok(calls.every(call => call.table === 'events' && !call.columns.includes('subtasks')));
});

test('sin eventos devuelve 200 y array vacío', async () => {
  rows = [];
  assert.deepEqual(await request(), { status: 200, body: [] });
});

test('ordena por date ASC e id ASC y recupera todas las páginas', async () => {
  const { body } = await request();
  assert.deepEqual(body.map(row => row.id), [id(1), id(2), id(3)]);
  assert.deepEqual(calls.map(call => call.range[0]), [0, 2]);
  for (const call of calls) {
    assert.deepEqual(call.orders, [
      { column: 'date', options: { ascending: true } },
      { column: 'id', options: { ascending: true } },
    ]);
    assert.equal(call.options.count, 'exact');
  }
});

test('fallo de Supabase devuelve 500 sin detalles internos', async () => {
  failure = true;
  assert.deepEqual(await request(), { status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'No fue posible completar la operación.' } } });
});

test('página inconsistente o incompleta no devuelve éxito parcial', async () => {
  corrupt = true;
  assert.equal((await request()).status, 500);
  corrupt = false;
  stopEarly = true;
  assert.equal((await request()).status, 500);
});

test('rechaza query de usuario y cualquier filtro no admitido', async () => {
  for (const key of ['userId', 'owner_id', 'ownerId', 'eventId', 'otro']) {
    const result = await request('test-a', `?${key}=${B}`);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(calls.length, 0);
});

test('rechaza cuerpo JSON incluso con usuario autenticado', async () => {
  const result = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ userId: B });
    const req = http.request(`${base}/api/eventos`, {
      method: 'GET', headers: { Authorization: 'Bearer test-a', 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  assert.equal(calls.length, 0);
});
