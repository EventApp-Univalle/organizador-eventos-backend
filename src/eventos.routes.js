const express = require('express');
const supabase = require('./supabase');
const {
  validateEventBody,
  validateSubtaskBody,
  isValidUuid,
} = require('./validation');

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
    .select('id')
    .eq('id', id)
    .eq('owner_id', userId)
    .maybeSingle();
}

async function ensureUserProfile(user) {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (error || data) return { error };

  const name = [
    user.user_metadata?.name,
    user.user_metadata?.full_name,
    typeof user.email === 'string' ? user.email.split('@')[0] : null,
    'Usuario',
  ].find((value) => typeof value === 'string' && value.trim()).trim();

  // ON CONFLICT DO NOTHING preserves an existing profile in concurrent requests.
  return supabase.from('users').upsert(
    { id: user.id, name },
    { onConflict: 'id', ignoreDuplicates: true }
  );
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
module.exports = router;
