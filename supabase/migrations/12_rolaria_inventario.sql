-- =========================================================
-- Rolaria como produto no inventário (tons)
-- - Adiciona categoria 'rolaria' a mp_standard
-- - Adiciona tipo 'consumo_rolaria' a movimentos
-- - Cria produtos "Rolaria <gama>" no mp_standard (1 por gama)
-- - Atualiza v_stock para descontar consumo_rolaria
-- - Trigger: sempre que entrada_producao tem rolaria_tons > 0, cria/atualiza
--   movimento espelho 'consumo_rolaria' (malotes = tons, m3 = 0)
-- - Backfill: gera espelhos para movimentos históricos
--
-- Idempotente. Stock de rolaria pode ir a negativo até existirem entradas
-- (compras virão do Primavera no futuro).
-- =========================================================

-- ---------------------------------------------------------
-- 1) Estender CHECK constraints
-- ---------------------------------------------------------
ALTER TABLE mp_standard DROP CONSTRAINT IF EXISTS mp_standard_categoria_check;
ALTER TABLE mp_standard ADD CONSTRAINT mp_standard_categoria_check
  CHECK (categoria IN ('tabuas','barrotes','outros','tabuas_charriot','duplos','costaneiros','rolaria'));

ALTER TABLE movimentos DROP CONSTRAINT IF EXISTS movimentos_tipo_check;
ALTER TABLE movimentos ADD CONSTRAINT movimentos_tipo_check
  CHECK (tipo IN ('entrada_producao','transferencia','ajuste_entrada','ajuste_saida','inventario','consumo_rolaria'));

-- ---------------------------------------------------------
-- 2) Criar produtos de rolaria em mp_standard (1 por gama)
--    produto_stock = "Rolaria <gama.nome>" (ex: "Rolaria 2100 mm - 191 a 220mm")
--    comprimento  = gama.comp_rolaria_mm
--    largura      = gama.diam_min_mm  (placeholder p/ ordenação)
--    espessura    = 0  (não aplicável)
--    pecas_por_malote = 1  (1 "malote" = 1 tonelada)
--    categoria    = 'rolaria'
-- ---------------------------------------------------------
INSERT INTO mp_standard (produto_stock, comprimento, largura, espessura, pecas_por_malote, categoria, ativo)
SELECT
  'Rolaria ' || nome,
  comp_rolaria_mm,
  diam_min_mm,
  0,
  1,
  'rolaria',
  true
FROM rolaria_gamas
WHERE ativo = true
ON CONFLICT (produto_conversao, produto_stock) DO NOTHING;

-- ---------------------------------------------------------
-- 3) Atualizar v_stock para descontar consumo_rolaria
--    (malotes em consumo_rolaria = tons, com sinal positivo guardado)
-- ---------------------------------------------------------
CREATE OR REPLACE VIEW v_stock AS
SELECT
  produto_stock,
  empresa,
  SUM(CASE
    WHEN tipo='entrada_producao' AND NOT estornado THEN malotes
    WHEN tipo='ajuste_entrada'   AND NOT estornado THEN malotes
    WHEN tipo='ajuste_saida'     AND NOT estornado THEN -malotes
    WHEN tipo='transferencia'    AND empresa_destino != empresa AND NOT estornado THEN -malotes
    WHEN tipo='inventario'       AND NOT estornado THEN malotes
    WHEN tipo='consumo_rolaria'  AND NOT estornado THEN -malotes
    ELSE 0
  END) AS malotes,
  SUM(CASE
    WHEN tipo='entrada_producao' AND NOT estornado THEN m3
    WHEN tipo='ajuste_entrada'   AND NOT estornado THEN m3
    WHEN tipo='ajuste_saida'     AND NOT estornado THEN -m3
    WHEN tipo='transferencia'    AND empresa_destino != empresa AND NOT estornado THEN -m3
    ELSE 0
  END) AS m3
FROM movimentos
WHERE duvida_resolvida = true
GROUP BY produto_stock, empresa;

-- ---------------------------------------------------------
-- 4) Trigger: sincroniza movimento-espelho 'consumo_rolaria'
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_rolaria_consumo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_admin uuid;
BEGIN
  -- Evita recursão: nunca processar movimentos espelho
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.tipo = 'consumo_rolaria' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.tipo = 'consumo_rolaria' THEN
    RETURN OLD;
  END IF;

  -- Em UPDATE/DELETE: apaga espelho antigo (será recriado se ainda válido)
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    DELETE FROM movimentos
    WHERE tipo = 'consumo_rolaria' AND movimento_origem_id = OLD.id;
  END IF;

  -- Em INSERT/UPDATE com rolaria_tons válido e não estornado: cria espelho
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND NEW.tipo = 'entrada_producao'
     AND NEW.empresa = 'MCF'
     AND NEW.rolaria_tons IS NOT NULL
     AND NEW.rolaria_tons > 0
     AND NEW.rolaria_gama IS NOT NULL
     AND NOT COALESCE(NEW.estornado, false)
     AND COALESCE(NEW.duvida_resolvida, true)
  THEN
    INSERT INTO movimentos (
      tipo, empresa, produto_stock, malotes, pecas_por_malote, m3,
      operador_id, incerteza, duvida_resolvida, estornado,
      movimento_origem_id, data_registo, criado_em
    ) VALUES (
      'consumo_rolaria',
      'MCF',
      'Rolaria ' || NEW.rolaria_gama,
      NEW.rolaria_tons,  -- tons guardadas em malotes
      1,
      0,
      NEW.operador_id,
      false,
      true,
      false,
      NEW.id,
      NEW.data_registo,
      now()
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_rolaria_consumo ON movimentos;
CREATE TRIGGER trg_sync_rolaria_consumo
  AFTER INSERT OR UPDATE OR DELETE ON movimentos
  FOR EACH ROW EXECUTE FUNCTION sync_rolaria_consumo();

-- ---------------------------------------------------------
-- 5) Backfill: gera espelhos para todos os movimentos
--    históricos com rolaria_tons > 0 que ainda não tenham espelho
-- ---------------------------------------------------------
INSERT INTO movimentos (
  tipo, empresa, produto_stock, malotes, pecas_por_malote, m3,
  operador_id, incerteza, duvida_resolvida, estornado,
  movimento_origem_id, data_registo, criado_em
)
SELECT
  'consumo_rolaria',
  'MCF',
  'Rolaria ' || m.rolaria_gama,
  m.rolaria_tons,
  1,
  0,
  m.operador_id,
  false,
  true,
  false,
  m.id,
  m.data_registo,
  now()
FROM movimentos m
WHERE m.tipo = 'entrada_producao'
  AND m.empresa = 'MCF'
  AND m.rolaria_tons IS NOT NULL
  AND m.rolaria_tons > 0
  AND m.rolaria_gama IS NOT NULL
  AND NOT COALESCE(m.estornado, false)
  AND COALESCE(m.duvida_resolvida, true)
  AND NOT EXISTS (
    SELECT 1 FROM movimentos e
    WHERE e.tipo = 'consumo_rolaria' AND e.movimento_origem_id = m.id
  );

-- ---------------------------------------------------------
-- 6) Index p/ lookup rápido de espelhos
-- ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mov_consumo_rolaria
  ON movimentos(movimento_origem_id)
  WHERE tipo = 'consumo_rolaria';
