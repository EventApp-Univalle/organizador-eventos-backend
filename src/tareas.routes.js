const express = require('express');
const supabase = require('./supabase');
const config = require('./config');

const router = express.Router();

function mapTask(row) {
  const event = row.events || row;

  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    date: row.target_date || row.date,
    estimatedHours: Number(row.estimated_hours),
    eventTitle: event.title,
    priority: event.is_priority ? 'Alta' : 'Media',
  };
}

router.get('/hoy', async (req, res) => {
  const [{ data: events, error: eventsError }, { data: subtasks, error: subtasksError }] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, date, is_priority, owner_id')
      .eq('owner_id', config.demoUserId),
    supabase
      .from('subtasks')
      .select(
        'id, event_id, title, target_date, estimated_hours, events!inner(title, is_priority, owner_id)'
      )
      .eq('events.owner_id', config.demoUserId)
      .order('target_date', { ascending: true })
      .order('estimated_hours', { ascending: true }),
  ]);

  if (eventsError || subtasksError) {
    const error = eventsError || subtasksError;
    console.error('Error al consultar las tareas de Hoy:', error.message);

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'No fue posible cargar las tareas de Hoy.',
      },
    });
  }

  const eventsWithTasks = new Set(subtasks.map((task) => task.event_id));
  const eventTasks = events
    .filter((event) => !eventsWithTasks.has(event.id))
    .map((event) => ({
      ...event,
      id: `event-${event.id}`,
      event_id: event.id,
      title: event.title,
      date: event.date,
      estimated_hours: 0,
    }));

  return res.status(200).json([...subtasks, ...eventTasks].map(mapTask));
});

module.exports = router;
