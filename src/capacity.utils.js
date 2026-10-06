const supabase = require('./supabase');
const { DAILY_CAPACITY } = require('./validation');

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function getDailyLimit(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('daily_capacity_hours')
    .eq('id', userId)
    .maybeSingle();

  if (error) return { error };
  const value = data?.daily_capacity_hours;
  return { limit: value != null ? round2(Number(value)) : DAILY_CAPACITY.DEFAULT };
}

async function sumDailyHours(userId, targetDate, { excludeSubtaskId = null } = {}) {
  const { data, error } = await supabase
    .from('subtasks')
    .select('id,estimated_hours,event:events!inner(owner_id)')
    .eq('event.owner_id', userId)
    .eq('target_date', targetDate);

  if (error) return { error };
  if (!Array.isArray(data)) return { error: new Error('Listado de tareas inconsistente.') };

  let total = 0;
  for (const row of data) {
    if (excludeSubtaskId && row.id === excludeSubtaskId) continue;
    total += Number(row.estimated_hours);
  }
  return { total: round2(total) };
}

module.exports = { getDailyLimit, sumDailyHours, round2 };
