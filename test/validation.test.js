const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateSubtaskBody,
  isValidUuid,
} = require('../src/validation');

test('validateSubtaskBody normaliza una subtarea válida', () => {
  const result = validateSubtaskBody({
    title: '  Confirmar sonido  ',
    targetDate: '2026-10-10',
    estimatedHours: 1.5,
  });

  assert.deepEqual(result, {
    valid: true,
    value: {
      title: 'Confirmar sonido',
      targetDate: '2026-10-10',
      estimatedHours: 1.5,
    },
  });
});

test('validateSubtaskBody rechaza strings y números no positivos en estimatedHours', () => {
  for (const estimatedHours of ['1.5', 0, -1, Number.NaN, Infinity, null]) {
    const result = validateSubtaskBody({
      title: 'Confirmar sonido',
      targetDate: '2026-10-10',
      estimatedHours,
    });

    assert.equal(result.valid, false);
    assert.equal(
      result.fields.estimatedHours,
      'Debe ser un número mayor que 0.'
    );
  }
});

test('validateSubtaskBody rechaza campos desconocidos y eventId en el body', () => {
  const result = validateSubtaskBody({
    title: 'Confirmar sonido',
    targetDate: '2026-10-10',
    estimatedHours: 1,
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'pendiente',
  });

  assert.equal(result.valid, false);
  assert.equal(result.fields.eventId, 'Campo no permitido.');
  assert.equal(result.fields.status, 'Campo no permitido.');
});

test('validateSubtaskBody rechaza fechas imposibles y títulos vacíos', () => {
  const result = validateSubtaskBody({
    title: '   ',
    targetDate: '2026-02-30',
    estimatedHours: 2,
  });

  assert.equal(result.valid, false);
  assert.ok(result.fields.title);
  assert.ok(result.fields.targetDate);
});

test('isValidUuid distingue UUID válidos e inválidos', () => {
  assert.equal(
    isValidUuid('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    true
  );
  assert.equal(isValidUuid('no-es-un-uuid'), false);
});
