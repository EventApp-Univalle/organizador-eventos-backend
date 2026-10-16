const supabase = require('./supabase');
const { DAILY_CAPACITY, isValidUuid } = require('./validation');
const { isCalendarDate } = require('./tareas.utils');

const PAGE_SIZE = 500;
const ZERO = { units: 0n, scale: 0 };

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Decimal integers avoid rounding a sum down, or rounding available hours up.
// Keep PostgreSQL numeric strings intact rather than converting them before summing.
function decimal(value) {
  if (!['number', 'string'].includes(typeof value) || !String(value).trim() ||
      !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Horas inconsistentes.');
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error('Horas inconsistentes.');
  const fraction = match[2] || '';
  const scale = fraction.length - Number(match[3] || 0);
  const units = BigInt(match[1] + fraction);
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}
function align(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * 10n ** BigInt(scale - a.scale), b.units * 10n ** BigInt(scale - b.scale), scale];
}
function add(a, b) {
  const [left, right, scale] = align(a, b);
  return { units: left + right, scale };
}
function compare(a, b) {
  const [left, right] = align(a, b);
  return left > right ? 1 : left < right ? -1 : 0;
}
function asNumber(value) {
  const digits = value.units.toString().padStart(value.scale + 1, '0');
  const number = Number(value.scale ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}` : digits);
  if (!Number.isFinite(number)) throw new Error('Carga fuera de rango.');
  return number;
}

async function getDailyLimit(userId) {
  const { data, error } = await supabase.from('users').select('daily_capacity_hours')
    .eq('id', userId).maybeSingle();
  if (error) return { error };
  const limit = data?.daily_capacity_hours != null ? Number(data.daily_capacity_hours) : DAILY_CAPACITY.DEFAULT;
  if (!Number.isFinite(limit) || limit < DAILY_CAPACITY.MIN || limit > DAILY_CAPACITY.MAX) {
    return { error: new Error('Capacidad diaria inconsistente.') };
  }
  return { limit };
}

async function getDailyLoads(userId, fromDate, toDate, excludeSubtaskId, onTask) {
  const loads = new Map();
  const seen = new Set();
  let offset = 0, expectedCount;
  while (true) {
    let query = supabase.from('subtasks').select(
      `id,event_id,target_date,estimated_hours${onTask ? ',title' : ''},event:events!inner(owner_id)`, { count: 'exact' }
    ).eq('event.owner_id', userId).gte('target_date', fromDate);
    if (toDate) query = query.lte('target_date', toDate);
    const { data, error, count } = await query.order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 ||
        (expectedCount !== undefined && expectedCount !== count) || offset + data.length > count ||
        (!data.length && offset < count)) throw new Error('Listado de carga incompleto.');
    expectedCount = count;
    for (const row of data) {
      if (typeof row.id !== 'string' || seen.has(row.id) || row.event?.owner_id !== userId ||
          !isCalendarDate(row.target_date) || row.target_date < fromDate || (toDate && row.target_date > toDate)) {
        throw new Error('Datos de carga inconsistentes.');
      }
      seen.add(row.id);
      if (row.id === excludeSubtaskId) continue;
      const hours = decimal(row.estimated_hours);
      if (hours.units <= 0n || Number(row.estimated_hours) <= 0) throw new Error('Horas inconsistentes.');
      loads.set(row.target_date, add(loads.get(row.target_date) || ZERO, hours));
      if (onTask) onTask(row, hours);
    }
    offset += data.length;
    if (offset === count) return loads;
  }
}

async function sumDailyHours(userId, targetDate, { excludeSubtaskId = null } = {}) {
  try {
    const loads = await getDailyLoads(userId, targetDate, targetDate, excludeSubtaskId);
    const load = loads.get(targetDate) || ZERO;
    return { total: asNumber(load), load };
  } catch (error) { return { error }; }
}

function assessDailyLoad(load, estimatedHours, limit) {
  const requested = decimal(estimatedHours);
  if (requested.units <= 0n) throw new Error('Horas inconsistentes.');
  const projected = add(load, requested);
  return { projectedHours: asNumber(projected), exceeds: compare(projected, decimal(limit)) > 0 };
}

function nextDate(date) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function suggestCapacityAlternatives({ userId, excludeSubtaskId, targetDate, estimatedHours,
  limit, referenceDate, eventDate }) {
  if (![targetDate, referenceDate, eventDate].every(isCalendarDate)) throw new Error('Plazo inconsistente.');
  const suggestions = [];
  if (referenceDate > eventDate) return { suggestions, noSuggestionsReason: 'El plazo del evento ya pasó. No hay fechas válidas para proponer.' };
  const loads = await getDailyLoads(userId, referenceDate, eventDate, excludeSubtaskId);
  const limitDecimal = decimal(limit);
  const requested = decimal(estimatedHours);
  if (compare(requested, limitDecimal) <= 0) {
    for (let date = referenceDate; date <= eventDate; date = nextDate(date)) {
      if (date !== targetDate && compare(add(loads.get(date) || ZERO, requested), limitDecimal) <= 0) {
        suggestions.push({ strategy: 'CHANGE_DATE', targetDate: date, estimatedHours });
        if (suggestions.length === 3) break;
      }
      if (date === eventDate) break;
    }
  }
  if (targetDate >= referenceDate && targetDate <= eventDate) {
    const [capacity, occupied, scale] = align(limitDecimal, loads.get(targetDate) || ZERO);
    if (capacity > occupied) {
      const available = { units: capacity - occupied, scale };
      let hours = asNumber(available);
      // A numeric -> JSON conversion may round up. Step down one representable
      // number until its decimal representation fits; do not invent a 0.01 minimum.
      while (hours > 0 && compare(decimal(hours), available) > 0) {
        const bits = new DataView(new ArrayBuffer(8));
        bits.setFloat64(0, hours);
        bits.setBigUint64(0, bits.getBigUint64(0) - 1n);
        hours = bits.getFloat64(0);
      }
      if (hours > 0 && hours < estimatedHours) suggestions.push({ strategy: 'ADJUST_HOURS', targetDate, estimatedHours: hours });
    }
  }
  return suggestions.length ? { suggestions } : { suggestions,
    noSuggestionsReason: 'No se encontraron fechas ni horas disponibles dentro del plazo del evento.' };
}

// One paginated read supplies both exact totals and the complete task detail.
// Only target dates from today onward are current review items; history stays intact.
async function loadCapacityImpact(userId, referenceDate) {
  if (!isCalendarDate(referenceDate)) throw new Error('Fecha de referencia inválida.');
  const tasksByDate = new Map();
  const loads = await getDailyLoads(userId, referenceDate, null, null, (row, hours) => {
    if (!isValidUuid(row.id) || !isValidUuid(row.event_id) || typeof row.title !== 'string' || !row.title.trim()) {
      throw new Error('Detalle de carga inconsistente.');
    }
    const tasks = tasksByDate.get(row.target_date) || [];
    tasks.push({ subtaskId: row.id, eventId: row.event_id, title: row.title, estimatedHours: asNumber(hours) });
    tasksByDate.set(row.target_date, tasks);
  });
  // Ensure every total can be represented in JSON before any capacity write.
  for (const load of loads.values()) asNumber(load);
  return { loads, tasksByDate };
}

function summarizeCapacityImpact(snapshot, limitHours) {
  if (!Number.isFinite(limitHours) || limitHours < DAILY_CAPACITY.MIN || limitHours > DAILY_CAPACITY.MAX) {
    throw new Error('Capacidad diaria inconsistente.');
  }
  const limit = decimal(limitHours);
  const affectedDays = [];
  for (const date of [...snapshot.loads.keys()].sort()) {
    const load = snapshot.loads.get(date);
    if (compare(load, limit) <= 0) continue;
    const [planned, allowed, scale] = align(load, limit);
    affectedDays.push({ date, plannedHours: asNumber(load), limitHours,
      excessHours: asNumber({ units: planned - allowed, scale }),
      tasks: [...snapshot.tasksByDate.get(date)].sort((a, b) => a.subtaskId.localeCompare(b.subtaskId)),
    });
  }
  return { hasOverload: affectedDays.length > 0, affectedDayCount: affectedDays.length, affectedDays };
}

module.exports = { getDailyLimit, sumDailyHours, round2, assessDailyLoad, suggestCapacityAlternatives, loadCapacityImpact, summarizeCapacityImpact };
