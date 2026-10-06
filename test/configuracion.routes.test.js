const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';

const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const scenario = {};
const calls = {};

function resetScenario() {
  scenario.profile = null;
  scenario.capacity = null;
  scenario.readError = null;
  scenario.upsertError = null;
  scenario.updateError = null;
  calls.filters = [];
  calls.updates = [];
  calls.upserts = [];
}

resetScenario();

function currentProfile() {
  if (!scenario.profile) return null;
  return { id: scenario.profile.id, daily_capacity_hours: scenario.capacity };
}

const supabaseMock = {
  auth: {
    async getUser() {
      return { data: { user: { id: USER_ID, email: 'test@example.com' } }, error: null };
    },
  },
  from(table) {
    const filters = [];
    let operation = 'read';
    let changes;

    function execute() {
      if (operation === 'read') {
        return { data: currentProfile(), error: scenario.readError };
      }
      if (operation === 'update') {
        calls.updates.push({ table, changes, filters: [...filters] });
        return { data: currentProfile(), error: scenario.updateError };
      }
      calls.upserts.push({ table, changes, filters: [...filters] });
      return { data: currentProfile(), error: scenario.upsertError };
    }

    return {
      select() { return this; },
      eq(column, value) {
        filters.push([column, value]);
        calls.filters.push([column, value]);
        return this;
      },
      update(value) { operation = 'update'; changes = value; return this; },
      upsert(value) { operation = 'upsert'; changes = value; return this; },
      async maybeSingle() { return execute(); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
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

async function request(path, { method, body, auth = true } = {}) {
  const headers = {};
  if (auth) headers.Authorization = 'Bearer test-user';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('GET devuelve el default cuando no está configurada', async () => {
  const { response, body } = await request('/api/configuracion/capacidad');
  assert.equal(response.status, 200);
  assert.deepEqual(body, { dailyLimitHours: 6, defaultDailyLimitHours: 6, isDefault: true });
});

test('GET devuelve la capacidad configurada', async () => {
  scenario.profile = { id: USER_ID };
  scenario.capacity = 8;
  const { response, body } = await request('/api/configuracion/capacidad');
  assert.equal(response.status, 200);
  assert.deepEqual(body, { dailyLimitHours: 8, defaultDailyLimitHours: 6, isDefault: false });
});

test('GET consulta solo el usuario autenticado', async () => {
  await request('/api/configuracion/capacidad');
  assert.ok(calls.filters.some(([column, value]) => column === 'id' && value === USER_ID));
});

test('GET sin token devuelve 401 AUTH_REQUIRED', async () => {
  const { response, body } = await request('/api/configuracion/capacidad', { auth: false });
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'AUTH_REQUIRED');
});

test('PATCH guarda una capacidad válida y devuelve la configuración', async () => {
  scenario.profile = { id: USER_ID };
  scenario.capacity = 8;
  const { response, body } = await request('/api/configuracion/capacidad', {
    method: 'PATCH',
    body: { dailyLimitHours: 8 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(body, { dailyLimitHours: 8, defaultDailyLimitHours: 6, isDefault: false });
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].changes.daily_capacity_hours, 8);
});

test('PATCH crea el perfil si no existe', async () => {
  const { response } = await request('/api/configuracion/capacidad', {
    method: 'PATCH',
    body: { dailyLimitHours: 7 },
  });
  assert.equal(response.status, 200);
  assert.ok(calls.upserts.length >= 1);
});

test('PATCH redondea a dos decimales', async () => {
  scenario.profile = { id: USER_ID };
  const { response, body } = await request('/api/configuracion/capacidad', {
    method: 'PATCH',
    body: { dailyLimitHours: 7.256 },
  });
  assert.equal(response.status, 200);
  assert.equal(body.dailyLimitHours, 7.26);
});

for (const dailyLimitHours of [0, -1, 25, 30]) {
  test(`PATCH rechaza fuera de rango ${dailyLimitHours}`, async () => {
    const { response, body } = await request('/api/configuracion/capacidad', {
      method: 'PATCH',
      body: { dailyLimitHours },
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.fields.dailyLimitHours);
    assert.equal(calls.updates.length, 0);
  });
}

for (const dailyLimitHours of ['8', null, true, {}]) {
  test(`PATCH rechaza tipo inválido ${JSON.stringify(dailyLimitHours)}`, async () => {
    const { response, body } = await request('/api/configuracion/capacidad', {
      method: 'PATCH',
      body: { dailyLimitHours },
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.fields.dailyLimitHours);
  });
}

test('PATCH rechaza campos no permitidos y body vacío', async () => {
  for (const body of [{}, { other: 1 }, { dailyLimitHours: 6, extra: 2 }]) {
    const { response, body: resBody } = await request('/api/configuracion/capacidad', {
      method: 'PATCH',
      body,
    });
    assert.equal(response.status, 400);
    assert.equal(resBody.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(calls.updates.length, 0);
});

test('PATCH controla errores internos sin exponer detalles', async () => {
  scenario.profile = { id: USER_ID };
  scenario.updateError = { message: 'detalle privado' };
  const { response, body } = await request('/api/configuracion/capacidad', {
    method: 'PATCH',
    body: { dailyLimitHours: 6 },
  });
  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(body).includes('detalle privado'), false);
});

