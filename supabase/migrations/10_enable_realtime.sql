-- =========================================================
-- Enable Supabase Realtime para as tabelas que a app subscreve
-- =========================================================

-- ALTER PUBLICATION requer superuser; Supabase Dashboard → Database → Replication
-- faz o mesmo via UI. Esta SQL é idempotente-safe (usa exception handler).

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE movimentos;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- REPLICA IDENTITY FULL permite que UPDATE/DELETE events incluam o row completo
-- (útil para client-side reconciliation).
ALTER TABLE movimentos REPLICA IDENTITY FULL;
ALTER TABLE pedidos REPLICA IDENTITY FULL;
