BEGIN;

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  type text NOT NULL CHECK (length(btrim(type)) > 0),
  date date NOT NULL,
  time time without time zone,
  location text,
  description text,
  is_priority boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL
    REFERENCES public.events(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  target_date date NOT NULL,
  estimated_hours numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subtasks_estimated_hours_positive_finite
    CHECK (
      estimated_hours > 0
      AND estimated_hours < 'Infinity'::numeric
    )
);

CREATE INDEX events_owner_id_idx
  ON public.events(owner_id);

CREATE INDEX subtasks_event_id_idx
  ON public.subtasks(event_id);

INSERT INTO public.users (id, name)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Usuario demo'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.users,
  public.events,
  public.subtasks
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE
  public.users,
  public.events,
  public.subtasks
FROM service_role;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON public.users TO service_role;

GRANT SELECT, INSERT ON public.events, public.subtasks
TO service_role;

COMMIT;
