const express = require('express');
const supabase = require('./supabase');
const { validateCapacityBody, DAILY_CAPACITY } = require('./validation');
const { ensureUserProfile } = require('./users.utils');

const router = express.Router();

function capacityResponse(dailyCapacityHours) {
  const isDefault = dailyCapacityHours == null;
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
  const { data, error } = await supabase
    .from('users')
    .select('daily_capacity_hours')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return internalError(res, 'consultar la capacidad diaria', error);

  return res.status(200).json(capacityResponse(data?.daily_capacity_hours ?? null));
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

  const { error: profileError } = await ensureUserProfile(req.user);
  if (profileError) {
    return internalError(res, 'preparar el perfil del usuario', profileError);
  }

  const { data, error } = await supabase
    .from('users')
    .update({ daily_capacity_hours: validation.value.dailyLimitHours })
    .eq('id', req.user.id)
    .select('daily_capacity_hours')
    .maybeSingle();

  if (error) return internalError(res, 'guardar la capacidad diaria', error);

  return res.status(200).json(
    capacityResponse(data?.daily_capacity_hours ?? validation.value.dailyLimitHours)
  );
});

module.exports = router;
