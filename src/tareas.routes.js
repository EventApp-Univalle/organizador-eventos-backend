const express = require('express');
const supabase = require('./supabase');
const { isValidUuid } = require('./validation');
const { getBogotaDate, groupTasksByDate } = require('./tareas.utils');

const router = express.Router();
const PAGE_SIZE = 500;

router.get('/hoy', async (req, res) => {
  const params = new URL(req.originalUrl, 'http://localhost').searchParams;
  const eventId = params.get('eventId');
  if ([...params.keys()].some((key) => key !== 'eventId') ||
      params.getAll('eventId').length > 1 ||
      (eventId !== null && !isValidUuid(eventId))) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Los parámetros de consulta no son válidos.' },
    });
  }

  const referenceDate = getBogotaDate();
  try {
    if (eventId !== null) {
      const { data, error } = await supabase.from('events').select('id')
        .eq('id', eventId).eq('owner_id', req.user.id).maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({
          error: { code: 'EVENT_NOT_FOUND', message: 'Evento no encontrado.' },
        });
      }
    }

    const tasks = [];
    let offset = 0;
    // Paginate internally so all future dates are included, without silent truncation.
    while (true) {
      let query = supabase.from('subtasks').select(
        'id,title,event_id,target_date,estimated_hours,event:events!inner(id,title,owner_id)',
        { count: 'exact' }
      ).eq('event.owner_id', req.user.id).order('id', { ascending: true });
      if (eventId !== null) query = query.eq('event_id', eventId);
      const { data, error, count } = await query.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
        throw new Error('Listado de tareas inconsistente.');
      }
      for (const row of data) {
        if (!row.event || row.event.owner_id !== req.user.id ||
            row.event.id !== row.event_id || typeof row.event.title !== 'string' ||
            typeof row.title !== 'string' || !isValidUuid(row.id) ||
            (eventId !== null && row.event_id !== eventId) ||
            !['number', 'string'].includes(typeof row.estimated_hours)) {
          throw new Error('Datos de tarea inconsistentes.');
        }
        tasks.push({
          id: row.id, title: row.title, eventId: row.event_id,
          eventTitle: row.event.title, targetDate: row.target_date,
          estimatedHours: Number(row.estimated_hours),
        });
      }
      offset += data.length;
      if (offset >= count) break;
      if (data.length === 0) throw new Error('Listado de tareas incompleto.');
    }

    return res.status(200).json(groupTasksByDate(tasks, referenceDate));
  } catch {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'No fue posible completar la operación.' },
    });
  }
});

module.exports = router;
