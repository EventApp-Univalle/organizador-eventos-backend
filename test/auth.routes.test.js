const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';

mock.method(require('../src/tareas.utils'), 'getBogotaDate', () => '2026-10-03');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const users = new Map();
const events = new Map();
const calls = { auth: [], queries: [], profiles: [], events: [], subtasks: [] };
let authError;
let authThrow;
let profileError;
let profileInsertError;
let raceProfile;
let identity;

function reset() {
  users.clear();
  events.clear();
  events.set(EVENT_ID, {
    id: EVENT_ID, owner_id: USER_A, title: 'Evento A', type: 'Cultural',
    date: '2026-10-15', time: null, location: null, description: null,
    is_priority: false, created_at: '2026-10-02T12:00:00.000Z',
  });
  for (const values of Object.values(calls)) values.length = 0;
  authError = null;
  authThrow = null;
  profileError = null;
  profileInsertError = null;
  raceProfile = null;
  identity = { email: 'organizador@example.test', user_metadata: { name: ' Miguel ' } };
}

const supabaseMock = {
  auth: {
    async getUser(token) {
      calls.auth.push(token);
      if (authThrow) throw authThrow;
      if (authError) return { data: { user: null }, error: authError };
      const id = { 'test-a': USER_A, 'test-b': USER_B }[token];
      return id
        ? { data: { user: { ...identity, id } }, error: null }
        : { data: { user: null }, error: { status: 401, code: 'bad_jwt' } };
    },
  },
  from(table) {
    const filters = {};
    let inserted;
    calls.queries.push(table);
    const builder = {
      select() { return builder; },
      eq(column, value) { filters[column] = value; return builder; },
      async maybeSingle() {
        if (table === 'users') {
          return { data: users.get(filters.id) || null, error: profileError };
        }
        const row = events.get(filters.id);
        return {
          data: row && row.owner_id === filters.owner_id ? row : null,
          error: null,
        };
      },
      async upsert(value, options) {
        calls.profiles.push({ value, options });
        if (profileInsertError) return { error: profileInsertError };
        if (raceProfile) users.set(value.id, { id: value.id, name: raceProfile });
        if (!users.has(value.id) || !options.ignoreDuplicates) users.set(value.id, value);
        return { error: null };
      },
      insert(value) {
        inserted = value;
        calls[table].push(value);
        return builder;
      },
      async single() {
        const row = { ...inserted, id: EVENT_ID, created_at: '2026-10-02T12:00:00.000Z' };
        events.set(row.id, row);
        return { data: row, error: null };
      },
      order() { return builder; },
      then(resolve, reject) {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
};

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: supabaseMock,
};
const app = require('../src/app');
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(reset);

const eventBody = { title: 'Encuentro', type: 'Cultural', date: '2026-10-15' };
const subtaskBody = { title: 'Sonido', targetDate: '2026-10-10', estimatedHours: 1.5 };

async function request(path, { authorization, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(authorization !== undefined ? { Authorization: authorization } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('las cuatro rutas privadas requieren Authorization', async () => {
  for (const [path, method, body] of [
    ['/api/eventos', 'POST', eventBody],
    [`/api/eventos/${EVENT_ID}`, 'GET'],
    [`/api/eventos/${EVENT_ID}/subtareas`, 'POST', subtaskBody],
    [`/api/eventos/${EVENT_ID}/subtareas`, 'GET'],
  ]) {
    const result = await request(path, { method, body });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'AUTH_REQUIRED');
  }
  assert.equal(calls.auth.length, 0);
  assert.equal(calls.queries.length, 0);
});

test('Bearer malformado se rechaza antes de llamar a Supabase', async () => {
  for (const authorization of ['Basic test-a', 'Bearer', 'Bearer test-a extra', 'Bearer test-a,test-b']) {
    const result = await request(`/api/eventos/${EVENT_ID}`, { authorization });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'INVALID_TOKEN');
  }
  assert.equal(calls.auth.length, 0);
});

test('token inválido devuelve 401 INVALID_TOKEN sin revelar el token', async () => {
  const result = await request(`/api/eventos/${EVENT_ID}`, { authorization: 'Bearer invalid-test' });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'INVALID_TOKEN');
  assert.equal(JSON.stringify(result.body).includes('invalid-test'), false);
  assert.equal(calls.queries.length, 0);
});

test('token vencido devuelve 401 INVALID_TOKEN', async () => {
  authError = { status: 403, code: 'jwt_expired' };
  const result = await request(`/api/eventos/${EVENT_ID}`, { authorization: 'Bearer test-a' });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'INVALID_TOKEN');
});

test('fallos técnicos de Auth devuelven 500 sin detalles internos', async () => {
  for (const error of [
    { status: 500, message: 'detalle privado' },
    { status: 429, message: 'detalle privado' },
  ]) {
    authError = error;
    const result = await request(`/api/eventos/${EVENT_ID}`, { authorization: 'Bearer test-a' });
    assert.equal(result.status, 500);
    assert.equal(result.body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(result.body).includes('detalle privado'), false);
  }
  assert.equal(calls.queries.length, 0);
});

test('excepción de red de Auth devuelve 500', async () => {
  authThrow = new Error('fallo de red');
  const result = await request(`/api/eventos/${EVENT_ID}`, { authorization: 'Bearer test-a' });
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
});

test('token válido permite a A consultar su evento', async () => {
  const result = await request(`/api/eventos/${EVENT_ID}`, { authorization: 'Bearer test-a' });
  assert.equal(result.status, 200);
  assert.equal(result.body.title, 'Evento A');
  assert.equal(result.body.id, EVENT_ID);
  assert.deepEqual(calls.auth, ['test-a']);
});

test('B no puede consultar el evento de A y recibe el mismo 404 que un ID inexistente', async () => {
  const foreign = await request(`/api/eventos/${EVENT_ID}`, { authorization: 'Bearer test-b' });
  const absent = await request(`/api/eventos/${USER_B}`, { authorization: 'Bearer test-b' });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign, absent);
  assert.equal(foreign.body.error.code, 'EVENT_NOT_FOUND');
});

test('B no puede crear subtareas en el evento de A', async () => {
  const result = await request(`/api/eventos/${EVENT_ID}/subtareas`, {
    authorization: 'Bearer test-b', method: 'POST', body: subtaskBody,
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'EVENT_NOT_FOUND');
  assert.equal(calls.subtasks.length, 0);
  assert.equal(calls.queries.includes('subtasks'), false);
});

test('B no puede listar subtareas del evento de A', async () => {
  const result = await request(`/api/eventos/${EVENT_ID}/subtareas`, { authorization: 'Bearer test-b' });
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'EVENT_NOT_FOUND');
  assert.equal(calls.queries.includes('subtasks'), false);
});

test('crear evento usa owner_id autenticado y crea perfil con ese UUID', async () => {
  const result = await request('/api/eventos', { authorization: 'Bearer test-a', method: 'POST', body: eventBody });
  assert.equal(result.status, 201);
  assert.equal(calls.events[0].owner_id, USER_A);
  assert.deepEqual(users.get(USER_A), { id: USER_A, name: 'Miguel' });
  assert.deepEqual(calls.profiles[0].options, { onConflict: 'id', ignoreDuplicates: true });
});

test('owner_id y userId enviados por cliente se rechazan sin crear perfil ni evento', async () => {
  for (const field of ['owner_id', 'userId']) {
    const result = await request('/api/eventos', {
      authorization: 'Bearer test-a', method: 'POST', body: { ...eventBody, [field]: USER_B },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.fields[field], 'Campo no permitido.');
  }
  assert.equal(calls.profiles.length, 0);
  assert.equal(calls.events.length, 0);
});

test('perfil existente no se duplica ni se modifica', async () => {
  users.set(USER_A, { id: USER_A, name: 'Nombre existente' });
  for (let index = 0; index < 2; index++) {
    const result = await request('/api/eventos', { authorization: 'Bearer test-a', method: 'POST', body: eventBody });
    assert.equal(result.status, 201);
  }
  assert.equal(users.size, 1);
  assert.equal(calls.profiles.length, 0);
  assert.equal(users.get(USER_A).name, 'Nombre existente');
});

test('perfil creado concurrentemente se conserva por ignoreDuplicates', async () => {
  raceProfile = 'Perfil concurrente';
  const result = await request('/api/eventos', { authorization: 'Bearer test-a', method: 'POST', body: eventBody });
  assert.equal(result.status, 201);
  assert.equal(users.get(USER_A).name, 'Perfil concurrente');
  assert.equal(users.size, 1);
});

test('nombre de perfil respeta full_name, email y fallback con tipos seguros', async () => {
  for (const [metadata, email, expected] of [
    [{ name: ' ', full_name: ' Hernán ' }, 'correo@example.test', 'Hernán'],
    [{ name: 123, full_name: {} }, 'daniel@example.test', 'daniel'],
    [{}, undefined, 'Usuario'],
  ]) {
    users.clear();
    identity = { user_metadata: metadata, email };
    const result = await request('/api/eventos', { authorization: 'Bearer test-a', method: 'POST', body: eventBody });
    assert.equal(result.status, 201);
    assert.equal(users.get(USER_A).name, expected);
  }
});

test('fallo al consultar perfil no crea evento ni devuelve detalles internos', async () => {
  profileError = { message: 'perfil privado' };
  const result = await request('/api/eventos', { authorization: 'Bearer test-a', method: 'POST', body: eventBody });
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
  assert.equal(calls.events.length, 0);
  assert.equal(JSON.stringify(result.body).includes('perfil privado'), false);
});

test('fallo al insertar perfil devuelve 500 y no crea evento', async () => {
  profileInsertError = { message: 'permiso de inserción denegado' };
  const result = await request('/api/eventos', { authorization: 'Bearer test-a', method: 'POST', body: eventBody });
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
  assert.equal(calls.events.length, 0);
  assert.equal(users.size, 0);
  assert.equal(JSON.stringify(result.body).includes('permiso'), false);
});

test('/health es público', async () => {
  const result = await request('/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.estado, 'ok');
  assert.equal(calls.auth.length, 0);
});

for (const date of ['2026-10-03', '2030-01-01']) {
  test(`crear evento permite hoy o futuro: ${date}`, async () => {
    const result = await request('/api/eventos', {
      authorization: 'Bearer test-a', method: 'POST', body: { ...eventBody, date },
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.date, date);
    assert.equal(calls.events[0].date, date);
    assert.equal(calls.events[0].owner_id, USER_A);
  });
}

test('crear evento rechaza fecha pasada antes de provisionar perfil o persistir', async () => {
  const result = await request('/api/eventos', {
    authorization: 'Bearer test-a', method: 'POST', body: { ...eventBody, date: '2026-10-02' },
  });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body.error, {
    code: 'VALIDATION_ERROR', message: 'Revisa los campos indicados.',
    fields: { date: 'La fecha del evento no puede ser anterior a hoy.' },
  });
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.profiles.length, 0);
  assert.equal(calls.events.length, 0);
});

test('crear evento conserva rechazo de formato y fechas calendario inválidas sin persistencia', async () => {
  for (const date of ['2026-02-30', '2026-13-01', '03/10/2026']) {
    const result = await request('/api/eventos', {
      authorization: 'Bearer test-a', method: 'POST', body: { ...eventBody, date },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.ok(result.body.error.fields.date);
  }
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.events.length, 0);
});
