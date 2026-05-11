-- =========================================================
-- Permitir UPDATE em movimentos para admins (resolver dúvidas, estornar, etc.)
-- Sem esta policy, o RLS bloqueia silenciosamente os updates do duvidas.js
-- =========================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'movimentos' AND policyname = 'update_movimentos') THEN
    DROP POLICY "update_movimentos" ON movimentos;
  END IF;
END $$;

CREATE POLICY "update_movimentos" ON movimentos FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND perfil IN ('admin', 'admin_producao')
  ));
