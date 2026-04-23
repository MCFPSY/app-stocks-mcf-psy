-- =========================================================
-- Transferências em 2 rows linkadas via movimento_origem_id
-- + v_stock atualizada para contar ambos os lados
-- =========================================================

-- 1) Criar row B para cada transferência existente que ainda não tem par
INSERT INTO movimentos (
  tipo, empresa, empresa_destino, produto_stock, malotes, pecas_por_malote, m3,
  operador_id, incerteza, duvida_resolvida, data_registo, turno,
  movimento_origem_id, criado_em
)
SELECT
  'transferencia',
  a.empresa_destino,          -- empresa passa a ser o destino (lado da entrada)
  a.empresa,                  -- empresa_destino passa a ser a origem (inversão semântica)
  a.produto_stock, a.malotes, a.pecas_por_malote, a.m3,
  a.operador_id, a.incerteza, a.duvida_resolvida, a.data_registo, a.turno,
  a.id,                       -- link para a row saída
  a.criado_em
FROM movimentos a
WHERE a.tipo = 'transferencia'
  AND a.movimento_origem_id IS NULL
  AND a.empresa_destino IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM movimentos b
    WHERE b.movimento_origem_id = a.id
  );

-- 2) Recriar v_stock: handle ambos os lados da transferência
DROP VIEW IF EXISTS v_stock;
CREATE VIEW v_stock AS
SELECT
  produto_stock,
  empresa,
  SUM(CASE
    WHEN tipo='entrada_producao' AND NOT estornado THEN malotes
    WHEN tipo='ajuste_entrada'   AND NOT estornado THEN malotes
    WHEN tipo='ajuste_saida'     AND NOT estornado THEN -malotes
    -- Transferência saída: row "A", sem movimento_origem_id
    WHEN tipo='transferencia'    AND movimento_origem_id IS NULL     AND NOT estornado THEN -malotes
    -- Transferência entrada: row "B", com movimento_origem_id a apontar à A
    WHEN tipo='transferencia'    AND movimento_origem_id IS NOT NULL AND NOT estornado THEN  malotes
    WHEN tipo='inventario'       AND NOT estornado THEN malotes
    ELSE 0
  END) AS malotes,
  SUM(CASE
    WHEN tipo='entrada_producao' AND NOT estornado THEN m3
    WHEN tipo='ajuste_entrada'   AND NOT estornado THEN m3
    WHEN tipo='ajuste_saida'     AND NOT estornado THEN -m3
    WHEN tipo='transferencia'    AND movimento_origem_id IS NULL     AND NOT estornado THEN -m3
    WHEN tipo='transferencia'    AND movimento_origem_id IS NOT NULL AND NOT estornado THEN  m3
    ELSE 0
  END) AS m3
FROM movimentos
WHERE duvida_resolvida = true
GROUP BY produto_stock, empresa;
