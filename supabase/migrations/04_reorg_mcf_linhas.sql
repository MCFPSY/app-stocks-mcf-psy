-- =========================================================
-- Reorg mcf_linhas: novas linhas madeira 2ª aprov + reordenar
-- =========================================================

-- 1) Inserir novas linhas (idempotente via ON CONFLICT)
INSERT INTO mcf_linhas (nome, hc, tipo_benchmark, sinal, categoria, ordem, ativo)
VALUES
  ('[+] Madeira de 2ª Aprov T1', 0, 'aproveitamentos', '+', 'costaneiros', 9,  true),
  ('[+] Madeira de 2ª Aprov T3', 0, 'aproveitamentos', '+', 'costaneiros', 11, true)
ON CONFLICT (nome) DO UPDATE SET
  tipo_benchmark = EXCLUDED.tipo_benchmark,
  sinal = EXCLUDED.sinal,
  categoria = EXCLUDED.categoria,
  ordem = EXCLUDED.ordem;

-- 2) Reordenar todas as linhas
UPDATE mcf_linhas SET ordem = 1  WHERE nome = 'Linha principal T1';
UPDATE mcf_linhas SET ordem = 2  WHERE nome = '[+] Madeira de 2ª T1';
UPDATE mcf_linhas SET ordem = 3  WHERE nome = 'Linha principal T3';
UPDATE mcf_linhas SET ordem = 4  WHERE nome = '[+] Madeira de 2ª T3';
UPDATE mcf_linhas SET ordem = 5  WHERE nome = 'Linha charriot [B]';
UPDATE mcf_linhas SET ordem = 6  WHERE nome = '[+] Linha charriot [Tábuas]';
UPDATE mcf_linhas SET ordem = 7  WHERE nome = 'Linha charriot [Duplos]';
UPDATE mcf_linhas SET ordem = 8  WHERE nome = 'Linha aproveitamentos T1';
UPDATE mcf_linhas SET ordem = 9  WHERE nome = '[+] Madeira de 2ª Aprov T1';
UPDATE mcf_linhas SET ordem = 10 WHERE nome = 'Linha aproveitamentos T3';
UPDATE mcf_linhas SET ordem = 11 WHERE nome = '[+] Madeira de 2ª Aprov T3';
UPDATE mcf_linhas SET ordem = 12 WHERE nome = '[-] Linha PSY';
UPDATE mcf_linhas SET ordem = 13 WHERE nome = '[-] Linha Aprov - Sobras';
