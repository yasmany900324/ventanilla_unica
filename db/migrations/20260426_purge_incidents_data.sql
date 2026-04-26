-- Sistema en modo solo-tramites: eliminar historico de incidencias.
DO $$
BEGIN
  IF to_regclass('public.incidents') IS NOT NULL THEN
    DELETE FROM incidents;
  END IF;
END $$;
