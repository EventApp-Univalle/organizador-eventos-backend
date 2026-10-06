BEGIN;

ALTER TABLE public.users
  ADD COLUMN daily_capacity_hours numeric
    CHECK (daily_capacity_hours >= 1 AND daily_capacity_hours <= 24);

-- El backend actualiza la capacidad por usuario usando service_role.
GRANT UPDATE ON public.users TO service_role;

COMMIT;
