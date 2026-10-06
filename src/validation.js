function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateEventBody(body, { partial = false } = {}) {
  const fields = Object.create(null);

  const allowedFields = [
    'title',
    'type',
    'date',
    'time',
    'location',
    'description',
    'isPriority',
  ];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      fields: {
        body: 'Debe ser un objeto JSON válido.',
      },
    };
  }

  if (partial && Object.keys(body).length === 0) fields.body = 'Envía al menos un campo para editar.';

  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      fields[key] = 'Campo no permitido.';
    }
  }

  if ((!partial || Object.hasOwn(body, 'title')) && (typeof body.title !== 'string' || !body.title?.trim())) {
    fields.title = 'El nombre del evento es obligatorio.';
  }

  if ((!partial || Object.hasOwn(body, 'type')) && (typeof body.type !== 'string' || !body.type?.trim())) {
    fields.type = 'El tipo de evento es obligatorio.';
  }

  if ((!partial || Object.hasOwn(body, 'date')) && (typeof body.date !== 'string' || !isValidDate(body.date))) {
    fields.date = 'La fecha debe tener formato YYYY-MM-DD y ser válida.';
  }

  if (
    body.time !== undefined &&
    body.time !== null &&
    body.time !== '' &&
    (typeof body.time !== 'string' || !isValidTime(body.time))
  ) {
    fields.time = 'La hora debe tener formato HH:mm.';
  }

  if (
    body.isPriority !== undefined &&
    typeof body.isPriority !== 'boolean'
  ) {
    fields.isPriority = 'Debe ser un booleano.';
  }

  for (const field of ['location', 'description']) {
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      typeof body[field] !== 'string'
    ) {
      fields[field] = 'Debe ser texto.';
    }
  }

  if (Object.keys(fields).length > 0) {
    return {
      valid: false,
      fields,
    };
  }

  const value = {
    title: body.title?.trim(),
    type: body.type?.trim(),
    date: body.date,
    time: body.time?.trim() || null,
    location: body.location?.trim() || null,
    description: body.description?.trim() || null,
    isPriority: body.isPriority ?? false,
  };
  return {
    valid: true,
    value: Object.fromEntries(Object.entries(value).filter(([key]) => !partial || Object.hasOwn(body, key))),
  };
}

function validateSubtaskBody(body, { partial = false } = {}) {
  const fields = Object.create(null);
  const allowedFields = ['title', 'targetDate', 'estimatedHours'];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      fields: {
        body: 'Debe ser un objeto JSON válido.',
      },
    };
  }

  if (partial && Object.keys(body).length === 0) fields.body = 'Envía al menos un campo para editar.';

  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      fields[key] = 'Campo no permitido.';
    }
  }

  if ((!partial || Object.hasOwn(body, 'title')) && (typeof body.title !== 'string' || !body.title?.trim())) {
    fields.title = 'El título de la subtarea es obligatorio.';
  }

  if ((!partial || Object.hasOwn(body, 'targetDate')) && (typeof body.targetDate !== 'string' || !isValidDate(body.targetDate))) {
    fields.targetDate =
      'La fecha objetivo debe tener formato YYYY-MM-DD y ser válida.';
  }

  if (
    (!partial || Object.hasOwn(body, 'estimatedHours')) && (
      typeof body.estimatedHours !== 'number' ||
      !Number.isFinite(body.estimatedHours) ||
      body.estimatedHours <= 0
    )
  ) {
    fields.estimatedHours = 'Debe ser un número mayor que 0.';
  }

  if (Object.keys(fields).length > 0) {
    return {
      valid: false,
      fields,
    };
  }

  const value = {
    title: body.title?.trim(),
    targetDate: body.targetDate,
    estimatedHours: body.estimatedHours,
  };
  return {
    valid: true,
    value: Object.fromEntries(Object.entries(value).filter(([key]) => !partial || Object.hasOwn(body, key))),
  };
}

const DAILY_CAPACITY = {
  MIN: 1,
  MAX: 24,
  DEFAULT: 6,
};

function validateCapacityBody(body) {
  const fields = Object.create(null);
  const allowedFields = ['dailyLimitHours'];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, fields: { body: 'Debe ser un objeto JSON válido.' } };
  }

  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      fields[key] = 'Campo no permitido.';
    }
  }

  const value = body.dailyLimitHours;
  if (!Object.hasOwn(body, 'dailyLimitHours')) {
    fields.dailyLimitHours = 'Es obligatorio.';
  } else if (typeof value !== 'number' || !Number.isFinite(value)) {
    fields.dailyLimitHours = 'Debe ser un número.';
  } else if (value < DAILY_CAPACITY.MIN || value > DAILY_CAPACITY.MAX) {
    fields.dailyLimitHours = `Debe ser un número entre ${DAILY_CAPACITY.MIN} y ${DAILY_CAPACITY.MAX}.`;
  }

  if (Object.keys(fields).length > 0) {
    return { valid: false, fields };
  }

  return {
    valid: true,
    value: { dailyLimitHours: Math.round(value * 100) / 100 },
  };
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
module.exports = {
  validateEventBody,
  validateSubtaskBody,
  validateCapacityBody,
  isValidUuid,
  DAILY_CAPACITY,
};
