-- El backend necesita crear perfiles con el UUID verificado por Supabase Auth.
-- SELECT ya está concedido; ignoreDuplicates no requiere actualizar perfiles.
GRANT INSERT ON TABLE public.users TO service_role;
