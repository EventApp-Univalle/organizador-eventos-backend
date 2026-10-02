const test = require('node:test');
const assert = require('node:assert/strict');
const { getBogotaDate, isCalendarDate, groupTasksByDate } = require('../src/tareas.utils');
const referenceDate = '2026-10-02';
const task = (id, targetDate, estimatedHours = 1) => ({ id, targetDate, estimatedHours });

test('fecha anterior, igual y posterior se clasifican con referencia explícita', () => {
  const tasks = [task('a', '2026-10-01'), task('b', referenceDate), task('c', '2026-10-03')];
  const groups = groupTasksByDate(tasks, referenceDate);
  assert.deepEqual(groups.overdue, [tasks[0]]);
  assert.deepEqual(groups.today, [tasks[1]]);
  assert.deepEqual(groups.upcoming, [tasks[2]]);
  assert.equal(groups.referenceDate, referenceDate);
});

test('cada grupo se ordena por fecha, esfuerzo e id sin mutar entrada', () => {
  for (const dates of [['2026-09-30', '2026-10-01'], [referenceDate, referenceDate], ['2026-10-03', '2026-10-04']]) {
    const tasks = [task('d', dates[1], 0.5), task('c', dates[0], 2), task('b', dates[0], 1), task('a', dates[0], 1)];
    const snapshot = structuredClone(tasks);
    const groups = groupTasksByDate(tasks, referenceDate);
    const result = [...groups.overdue, ...groups.today, ...groups.upcoming];
    const expected = dates[0] === dates[1] ? ['d', 'a', 'b', 'c'] : ['a', 'b', 'c', 'd'];
    assert.deepEqual(result.map(t => t.id), expected);
    assert.deepEqual(tasks, snapshot);
  }
});

test('los tres grupos existen aunque no haya tareas', () => {
  assert.deepEqual(groupTasksByDate([], referenceDate), { referenceDate, overdue: [], today: [], upcoming: [] });
});

test('agrupación no usa el reloj real', () => {
  assert.equal(groupTasksByDate([task('a', '2000-01-01')], '2000-01-01').today.length, 1);
});

test('Bogotá usa la fecha local incluso cuando UTC está en el día siguiente', () => {
  assert.equal(getBogotaDate(new Date('2026-10-03T04:59:59Z')), '2026-10-02');
  assert.equal(getBogotaDate(new Date('2026-10-03T05:00:00Z')), '2026-10-03');
});

test('fechas imposibles y esfuerzos inconsistentes se rechazan', () => {
  assert.equal(isCalendarDate('2026-02-30'), false);
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.throws(() => groupTasksByDate([], '2026-02-30'));
  for (const value of [null, '1.5', 0, -1, NaN, Infinity]) {
    assert.throws(() => groupTasksByDate([task('a', referenceDate, value)], referenceDate));
  }
  assert.throws(() => groupTasksByDate([task('a', '2026-02-30')], referenceDate));
});
