const express = require('express');
const supabase = require('./supabase');
const { validateCapacityBody, DAILY_CAPACITY } = require('./validation');
const { ensureUserProfile } = require('./users.utils');

const { loadCapacityImpact, summarizeCapacityImpact } = require('./capacity.utils');
const { getBogotaDate } = require('./tareas.utils');

const router = express.Router();

function capacityResponse(dailyCapacityHours) {
  const isDefault = dailyCapacityHours == null;
  if (!isDefault && (!['number', 'string'].includes(typeof dailyCapacityHours) ||
      !Number.isFinite(Number(dailyCapacityHours)) || Number(dailyCapacityHours) < DAILY_CAPACITY.MIN ||
      Number(dailyCapacityHours) > DAILY_CAPACITY.MAX)) throw new Error('Capacidad inconsistente.');
  return {
    dailyLimitHours: isDefault ? DAILY_CAPACITY.DEFAULT : Number(dailyCapacityHours),
    defaultDailyLimitHours: DAILY_CAPACITY.DEFAULT,
    isDefault,
  };
}

function internalError(res, operation, error) {
  console.error(`Error al ${operation}:`, error.message);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'No fue posible completar la operación.',
    },
  });
}

router.get('/capacidad', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id,daily_capacity_hours')
      .eq('id', req.user.id).maybeSingle();
    if (error) throw error;
    if (data && data.id !== req.user.id) throw new Error('Perfil inconsistente.');
    const response = capacityResponse(data?.daily_capacity_hours ?? null);
    const snapshot = await loadCapacityImpact(req.user.id, getBogotaDate());
    return res.status(200).json({ ...response, impact: summarizeCapacityImpact(snapshot, response.dailyLimitHours) });
  } catch (error) { return internalError(res, 'consultar la capacidad y su impacto', error); }
});

router.patch('/capacidad', async (req, res) => {
  const validation = validateCapacityBody(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos indicados.',
        fields: validation.fields,
      },
    });
  }

  try {
    // Read the complete plan before writing. A failed/incomplete analysis does not save capacity.
    const snapshot = await loadCapacityImpact(req.user.id, getBogotaDate());
    const impact = summarizeCapacityImpact(snapshot, validation.value.dailyLimitHours);
    const { error: profileError } = await ensureUserProfile(req.user);
    if (profileError) throw profileError;
    const { data, error } = await supabase.from('users')
      .update({ daily_capacity_hours: validation.value.dailyLimitHours })
      .eq('id', req.user.id).select('id,daily_capacity_hours').maybeSingle();
    if (error) throw error;
    if (!data || data.id !== req.user.id || data.daily_capacity_hours == null) {
      throw new Error('No se confirmó la fila guardada.');
    }
    const response = capacityResponse(data.daily_capacity_hours);
    // The returned row is authoritative, even if it differs from the requested value.
    const confirmedImpact = response.dailyLimitHours === validation.value.dailyLimitHours ? impact
      : summarizeCapacityImpact(snapshot, response.dailyLimitHours);
    return res.status(200).json({ ...response, impact: confirmedImpact });
  } catch (error) { return internalError(res, 'guardar la capacidad y calcular su impacto', error); }
});

module.exports = router;
