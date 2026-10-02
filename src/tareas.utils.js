function getBogotaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function groupTasksByDate(tasks, referenceDate) {
  if (!isCalendarDate(referenceDate)) throw new Error('Fecha de referencia inválida.');
  const groups = { overdue: [], today: [], upcoming: [] };

  for (const task of tasks) {
    if (!isCalendarDate(task.targetDate) ||
        !Number.isFinite(task.estimatedHours) || task.estimatedHours <= 0 ||
        typeof task.id !== 'string') {
      throw new Error('Datos de tarea inconsistentes.');
    }
    const group = task.targetDate < referenceDate ? 'overdue'
      : task.targetDate === referenceDate ? 'today' : 'upcoming';
    groups[group].push(task);
  }

  for (const group of Object.values(groups)) {
    group.sort((a, b) => a.targetDate.localeCompare(b.targetDate)
      || a.estimatedHours - b.estimatedHours || a.id.localeCompare(b.id));
  }
  return { referenceDate, ...groups };
}

module.exports = { getBogotaDate, isCalendarDate, groupTasksByDate };
