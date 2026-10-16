const supabase = require('./supabase');
const { isValidUuid } = require('./validation');
const STATUSES = ['PENDING', 'DONE', 'POSTPONED'];

function taskStatus(row) {
  // Compatibility with older in-process callers; migrated database rows are NOT NULL.
  const status = row.status ?? 'PENDING';
  if (!STATUSES.includes(status)) throw new Error('Estado de subtarea inconsistente.');
  return status;
}
function progressOf(tasks) {
  const totalCount = tasks.length;
  const doneCount = tasks.filter(row => taskStatus(row) === 'DONE').length;
  return { doneCount, totalCount, progressPercent: totalCount ? (doneCount / totalCount) * 100 : 0 };
}

// Exact counts and stable IDs prevent silently accepting a truncated response.
async function readAll(buildQuery) {
  const rows = [], ids = new Set();
  let count;
  while (true) {
    const { data, error, count: current } = await buildQuery()
      .order('id', { ascending: true }).range(rows.length, rows.length + 499);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(current) || current < 0 ||
        (count !== undefined && count !== current) || rows.length + data.length > current ||
        (!data.length && rows.length < current)) throw new Error('Listado incompleto.');
    count = current;
    for (const row of data) {
      if (!isValidUuid(row?.id) || ids.has(row.id)) throw new Error('Registro inconsistente.');
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === count) return rows;
  }
}
async function ownedProgress(userId, eventId) {
  const events = await readAll(() => {
    let query = supabase.from('events').select('id,title,owner_id', { count: 'exact' }).eq('owner_id', userId);
    return eventId ? query.eq('id', eventId) : query;
  });
  if (events.some(row => row.owner_id !== userId || typeof row.title !== 'string')) throw new Error('Evento inconsistente.');
  if (eventId && !events.length) return null;
  const byId = new Map(events.map(event => [event.id, []]));
  const tasks = await readAll(() => {
    let query = supabase.from('subtasks')
      .select('id,event_id,status,event:events!inner(owner_id)', { count: 'exact' })
      .eq('event.owner_id', userId);
    return eventId ? query.eq('event_id', eventId) : query;
  });
  for (const task of tasks) {
    if (task.event?.owner_id !== userId || !byId.has(task.event_id)) throw new Error('Subtarea inconsistente.');
    byId.get(task.event_id).push(task);
  }
  return events.map(event => ({ eventId: event.id, eventTitle: event.title, ...progressOf(byId.get(event.id)) }));
}
module.exports = { STATUSES, taskStatus, progressOf, readAll, ownedProgress };
