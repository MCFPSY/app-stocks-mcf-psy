-- =========================================================
-- Migrar psy_producao → movimentos (empresa='PSY') + recriar v_psy_semanal
-- =========================================================

-- 1) Copiar todos os registos psy_producao para movimentos (idempotente via id)
INSERT INTO movimentos (
  id, tipo, empresa, produto_stock, malotes, pecas_por_malote, m3,
  operador_id, incerteza, duvida_resolvida, data_registo, linha, turno,
  justificacao, desvio_objetivo, criado_em
)
SELECT
  id, 'entrada_producao', 'PSY', produto, quantidade, 1, 0,
  operador_id, COALESCE(incerteza, false), true, data_registo, linha, turno,
  justificacao, desvio_objetivo, criado_em
FROM psy_producao
ON CONFLICT (id) DO NOTHING;

-- 2) Recriar v_psy_semanal sobre movimentos
DROP VIEW IF EXISTS v_psy_semanal;
CREATE VIEW v_psy_semanal AS
SELECT
  linha, turno,
  produto_stock AS produto,
  to_char(date_trunc('week', data_registo::date), 'IYYY"-W"IW') AS semana,
  SUM(malotes)::numeric AS qty_total
FROM movimentos
WHERE tipo = 'entrada_producao'
  AND empresa = 'PSY'
  AND NOT estornado
  AND duvida_resolvida
GROUP BY linha, turno, produto_stock, semana;
