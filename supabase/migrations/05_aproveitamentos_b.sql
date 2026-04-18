-- =========================================================
-- Aproveitamentos (B) — máquina alternativa de aproveitamentos
-- 6 linhas novas + reordenação
-- =========================================================

-- 1) Inserir novas linhas (idempotente)
INSERT INTO mcf_linhas (nome, hc, tipo_benchmark, sinal, categoria, ordem, ativo)
VALUES
  ('Linha aproveitamentos T1 (B)',       0, 'aproveitamentos', '+', 'costaneiros', 12, true),
  ('[+] Madeira de 2ª Aprov T1 (B)',     0, 'aproveitamentos', '+', 'costaneiros', 13, true),
  ('Linha aproveitamentos T2 (B)',       0, 'aproveitamentos', '+', 'costaneiros', 14, true),
  ('[+] Madeira de 2ª Aprov T2 (B)',     0, 'aproveitamentos', '+', 'costaneiros', 15, true),
  ('Linha aproveitamentos T3 (B)',       0, 'aproveitamentos', '+', 'costaneiros', 16, true),
  ('[+] Madeira de 2ª Aprov T3 (B)',     0, 'aproveitamentos', '+', 'costaneiros', 17, true)
ON CONFLICT (nome) DO UPDATE SET
  tipo_benchmark = EXCLUDED.tipo_benchmark,
  sinal = EXCLUDED.sinal,
  categoria = EXCLUDED.categoria,
  ordem = EXCLUDED.ordem,
  ativo = true;

-- 2) Reordenar PSY + Aprov-Sobras para ficarem depois dos (B)
UPDATE mcf_linhas SET ordem = 18 WHERE nome = '[-] Linha PSY';
UPDATE mcf_linhas SET ordem = 19 WHERE nome = '[-] Linha Aprov - Sobras';
