const express = require('express');
const supabase = require('./supabase');
const { getBogotaDate, isCalendarDate } = require('./tareas.utils');
const {
  validateEventBody,
  validateSubtaskBody,
  isValidUuid,
} = require('./validation');
const { ensureUserProfile } = require('./users.utils');
const { getDailyLimit, sumDailyHours, round2 } = require('./capacity.utils');

const router = express.Router();
const PAGE_SIZE = 500;

function mapEvent(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    date: row.date,
    time: row.time ? row.time.slice(0, 5) : null,
    location: row.location,
    description: row.description,
    isPriority: row.is_priority,
    createdAt: row.created_at,
  };
}

function mapSubtask(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    targetDate: row.target_date,
    estimatedHours: Number(row.estimated_hours),
    createdAt: row.created_at,
  };
}

function invalidEventIdResponse(res) {
  return res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'El identificador del evento no es válido.',
      fields: {
        id: 'Debe ser un UUID válido.',
      },
    },
  });
}

function eventNotFoundResponse(res) {
  return res.status(404).json({
    error: {
      code: 'EVENT_NOT_FOUND',
      message: 'Evento no encontrado.',
    },
  });
}

function internalErrorResponse(res, operation, error) {
  console.error(`Error al ${operation}:`, error.message);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'No fue posible completar la operación.',
    },
  });
}

function findOwnedEvent(id, userId) {
  return supabase
    .from('events')
    .select('id,date')
    .eq('id', id)
    .eq('owner_id', userId)
    .maybeSingle();
}

router.get('/', async (req, res) => {
  // Identity only comes from the authenticated session; this listing has no filters/body.
  if (new URL(req.originalUrl, 'http://localhost').search || req.body !== undefined) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'El listado no admite parámetros ni cuerpo JSON.' },
    });
  }

  try {
    const events = [];
    let offset = 0;
    while (true) {
      const { data, error, count } = await supabase.from('events')
        .select('id,owner_id,title,type,date,time,location,description,is_priority,created_at', { count: 'exact' })
        .eq('owner_id', req.user.id)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!Array.isArray(data) || !Number.isInteger(count) || count < 0 ||
          data.some(row => !row || row.owner_id !== req.user.id)) {
        throw new Error('Listado de eventos inconsistente.');
      }
      events.push(...data.map(mapEvent));
      offset += data.length;
      if (offset >= count) break;
      if (data.length === 0) throw new Error('Listado de eventos incompleto.');
    }
    return res.status(200).json(events);
  } catch {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'No fue posible completar la operación.' },
    });
  }
});

router.post('/', async (req, res) => {
  const validation = validateEventBody(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos indicados.',
        fields: validation.fields,
      },
    });
  }

  const event = validation.value;
  if (event.date < getBogotaDate()) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos indicados.',
        fields: { date: 'La fecha del evento no puede ser anterior a hoy.' },
      },
    });
  }

  const { error: profileError } = await ensureUserProfile(req.user);
  if (profileError) {
    return internalErrorResponse(res, 'preparar el perfil del usuario', profileError);
  }

  const { data, error } = await supabase
    .from('events')
    .insert({
      owner_id: req.user.id,
      title: event.title,
      type: event.type,
      date: event.date,
      time: event.time,
      location: event.location,
      description: event.description,
      is_priority: event.isPriority,
    })
    .select()
    .single();

  if (error) {
    console.error('Error al crear evento:', error.message);

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'No fue posible completar la operación.',
      },
    });
  }

  const response = mapEvent(data);

  res
    .status(201)
    .location(`/api/eventos/${response.id}`)
    .json(response);
});

router.post('/:id/subtareas', async (req, res) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return invalidEventIdResponse(res);
  }

  const validation = validateSubtaskBody(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos indicados.',
        fields: validation.fields,
      },
    });
  }

  const { data: event, error: eventError } = await findOwnedEvent(id, req.user.id);

  if (eventError) {
    return internalErrorResponse(
      res,
      'comprobar el evento de la subtarea',
      eventError
    );
  }

  if (!event) {
    return eventNotFoundResponse(res);
  }

  const subtask = validation.value;
  if (!isCalendarDate(event.date)) {
    return internalErrorResponse(res, 'comprobar la fecha del evento', new Error('Fecha inconsistente.'));
  }
  const today = getBogotaDate();
  const dateError = subtask.targetDate < today
    ? 'La fecha no puede ser anterior a hoy.'
    : subtask.targetDate > event.date
      ? 'La fecha no puede ser posterior a la fecha del evento.'
      : null;
  if (dateError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos indicados.',
        fields: { targetDate: dateError },
      },
    });
  }

  const { data, error } = await supabase
    .from('subtasks')
    .insert({
      event_id: id,
      title: subtask.title,
      target_date: subtask.targetDate,
      estimated_hours: subtask.estimatedHours,
    })
    .select()
    .single();

  if (error) {
    return internalErrorResponse(res, 'crear la subtarea', error);
  }

  return res.status(201).json(mapSubtask(data));
});

router.get('/:id/subtareas', async (req, res) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return invalidEventIdResponse(res);
  }

  const { data: event, error: eventError } = await findOwnedEvent(id, req.user.id);

  if (eventError) {
    return internalErrorResponse(
      res,
      'comprobar el evento de las subtareas',
      eventError
    );
  }

  if (!event) {
    return eventNotFoundResponse(res);
  }

  const { data, error } = await supabase
    .from('subtasks')
    .select('*')
    .eq('event_id', id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    return internalErrorResponse(res, 'consultar las subtareas', error);
  }

  return res.status(200).json(data.map(mapSubtask));
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return invalidEventIdResponse(res);
  }

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .eq('owner_id', req.user.id)
    .maybeSingle();

  if (error) {
    console.error('Error al consultar evento:', error.message);

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'No fue posible completar la operación.',
      },
    });
  }

  if (!data) {
    return eventNotFoundResponse(res);
  }

  return res.status(200).json(mapEvent(data));
});

function validationResponse(res, fields, message = 'Revisa los campos indicados.') {
  return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message, fields } });
}

function subtaskNotFoundResponse(res) {
  return res.status(404).json({ error: { code: 'SUBTASK_NOT_FOUND', message: 'Subtarea no encontrada.' } });
}

async function ownedCrudEvent(req, res) {
  if (!isValidUuid(req.params.id)) {
    invalidEventIdResponse(res);
    return null;
  }
  const { data, error } = await findOwnedEvent(req.params.id, req.user.id);
  if (error) { internalErrorResponse(res, 'comprobar el evento', error); return null; }
  if (!data) { eventNotFoundResponse(res); return null; }
  return data;
}

async function ownedCrudSubtask(req, res) {
  if (!isValidUuid(req.params.subtaskId)) {
    validationResponse(res, { subtaskId: 'Debe ser un UUID válido.' });
    return null;
  }
  const { data, error } = await supabase.from('subtasks').select('*')
    .eq('id', req.params.subtaskId).eq('event_id', req.params.id).maybeSingle();
  if (error) { internalErrorResponse(res, 'comprobar la subtarea', error); return null; }
  if (!data) { subtaskNotFoundResponse(res); return null; }
  return data;
}

router.patch('/:id', async (req, res) => {
  const event = await ownedCrudEvent(req, res);
  if (!event) return;
  const validation = validateEventBody(req.body, { partial: true });
  if (!validation.valid) return validationResponse(res, validation.fields);
  const value = validation.value;
  if (value.date !== undefined) {
    if (value.date < getBogotaDate()) {
      return validationResponse(res, { date: 'La fecha del evento no puede ser anterior a hoy.' });
    }
    if (value.date !== event.date) {
      // One matching row suffices; no truncation of the conflict check.
      const { data, error } = await supabase.from('subtasks').select('id')
        .eq('event_id', req.params.id).gt('target_date', value.date).limit(1);
      if (error || !Array.isArray(data)) return internalErrorResponse(res, 'comprobar fechas', error || new Error('Datos inconsistentes.'));
      if (data.length) return validationResponse(res,
        { date: 'Hay subtareas con fecha posterior a la nueva fecha del evento.' },
        'Hay subtareas con fecha posterior a la nueva fecha del evento.');
    }
  }
  const changes = { ...value };
  if (Object.hasOwn(changes, 'isPriority')) {
    changes.is_priority = changes.isPriority;
    delete changes.isPriority;
  }
  const { data, error } = await supabase.from('events').update(changes)
    .eq('id', req.params.id).eq('owner_id', req.user.id).select('*').maybeSingle();
  if (error) return internalErrorResponse(res, 'editar el evento', error);
  if (!data) return eventNotFoundResponse(res);
  return res.status(200).json(mapEvent(data));
});

router.delete('/:id', async (req, res) => {
  const event = await ownedCrudEvent(req, res);
  if (!event) return;
  const { data: children, error: childrenError } = await supabase.from('subtasks')
    .select('id').eq('event_id', req.params.id).limit(1);
  if (childrenError || !Array.isArray(children)) return internalErrorResponse(res, 'comprobar subtareas', childrenError || new Error('Datos inconsistentes.'));
  const conflict = () => res.status(400).json({ error: {
    code: 'EVENT_HAS_SUBTASKS', message: 'Primero elimina las subtareas de este evento.',
  } });
  if (children.length) return conflict();
  const { data, error } = await supabase.from('events').delete()
    .eq('id', req.params.id).eq('owner_id', req.user.id).select('id').maybeSingle();
  // The existing RESTRICT FK also protects a concurrent insertion.
  if (error?.code === '23503') return conflict();
  if (error) return internalErrorResponse(res, 'eliminar el evento', error);
  if (!data) return eventNotFoundResponse(res);
  return res.status(200).json({ id: data.id, deleted: true });
});

router.patch('/:id/subtareas/:subtaskId', async (req, res) => {
  const event = await ownedCrudEvent(req, res);
  if (!event) return;
  const subtask = await ownedCrudSubtask(req, res);
  if (!subtask) return;
  const validation = validateSubtaskBody(req.body, { partial: true });
  if (!validation.valid) return validationResponse(res, validation.fields);
  const value = validation.value;
  if (value.targetDate !== undefined && value.targetDate !== subtask.target_date) {
    const message = value.targetDate < getBogotaDate() ? 'La fecha no puede ser anterior a hoy.'
      : value.targetDate > event.date ? 'La fecha no puede ser posterior a la fecha del evento.' : null;
    if (message) return validationResponse(res, { targetDate: message });
  }

  if (value.targetDate !== undefined || value.estimatedHours !== undefined) {
    const effectiveDate = value.targetDate ?? subtask.target_date;
    const effectiveHours = value.estimatedHours ?? Number(subtask.estimated_hours);

    const { limit, error: limitError } = await getDailyLimit(req.user.id);
    if (limitError) return internalErrorResponse(res, 'consultar la capacidad diaria', limitError);

    const { total, error: totalError } = await sumDailyHours(req.user.id, effectiveDate, {
      excludeSubtaskId: subtask.id,
    });
    if (totalError) return internalErrorResponse(res, 'calcular la carga diaria', totalError);

    const projectedHours = round2(total + effectiveHours);
    if (projectedHours > limit) {
      return res.status(409).json({
        error: {
          code: 'DAILY_CAPACITY_EXCEEDED',
          message: `Al reprogramar, la fecha tendría ${projectedHours} h, superando tu límite diario de ${limit} h.`,
          details: {
            targetDate: effectiveDate,
            totalHours: projectedHours,
            limitHours: limit,
          },
        },
      });
    }
  }

  const changes = {};
  if (Object.hasOwn(value, 'title')) changes.title = value.title;
  if (Object.hasOwn(value, 'targetDate')) changes.target_date = value.targetDate;
  if (Object.hasOwn(value, 'estimatedHours')) changes.estimated_hours = value.estimatedHours;
  const { data, error } = await supabase.from('subtasks').update(changes)
    .eq('id', req.params.subtaskId).eq('event_id', req.params.id).select('*').maybeSingle();
  if (error) return internalErrorResponse(res, 'editar la subtarea', error);
  if (!data) return subtaskNotFoundResponse(res);
  return res.status(200).json(mapSubtask(data));
});

router.delete('/:id/subtareas/:subtaskId', async (req, res) => {
  const event = await ownedCrudEvent(req, res);
  if (!event) return;
  const subtask = await ownedCrudSubtask(req, res);
  if (!subtask) return;
  const { data, error } = await supabase.from('subtasks').delete()
    .eq('id', req.params.subtaskId).eq('event_id', req.params.id).select('id').maybeSingle();
  if (error) return internalErrorResponse(res, 'eliminar la subtarea', error);
  if (!data) return subtaskNotFoundResponse(res);
  return res.status(200).json({ id: data.id, deleted: true });
});

module.exports = router;
