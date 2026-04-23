-- =========================================================
-- Persistir tons de rolaria + gama em cada movimento de produção
-- =========================================================

ALTER TABLE movimentos ADD COLUMN IF NOT EXISTS rolaria_tons numeric;
ALTER TABLE movimentos ADD COLUMN IF NOT EXISTS rolaria_gama text;

CREATE INDEX IF NOT EXISTS idx_mov_rolaria_gama ON movimentos(rolaria_gama) WHERE rolaria_gama IS NOT NULL;
