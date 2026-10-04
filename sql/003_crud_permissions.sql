-- Permisos para CRUD desde Express con service_role; no habilita acceso directo de clientes.
GRANT UPDATE, DELETE ON public.events, public.subtasks TO service_role;
