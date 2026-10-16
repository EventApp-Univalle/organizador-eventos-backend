-- Sprint 4: ejecución persistente; las subtareas existentes quedan pendientes.
-- Aplicar manualmente en SQL Editor después de revisar, antes de desplegar el backend.
BEGIN;
ALTER TABLE public.subtasks
  ADD COLUMN status text NOT NULL DEFAULT 'PENDING'
    CONSTRAINT subtasks_status_valid CHECK (status IN ('PENDING', 'DONE', 'POSTPONED')),
  ADD COLUMN execution_note text
    CONSTRAINT subtasks_execution_note_length CHECK (length(execution_note) <= 2000),
  ADD COLUMN execution_updated_at timestamptz;
-- No cambia fechas, esfuerzos, usuarios ni permisos. No crea un historial.
COMMIT;
