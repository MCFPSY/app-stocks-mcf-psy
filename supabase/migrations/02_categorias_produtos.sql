-- =========================================================
-- Fase 2b: Expandir categorias de mp_standard + atualizar mcf_linhas
-- Idempotente. Correr no Supabase SQL Editor.
-- =========================================================

-- 1) Expandir CHECK constraint de mp_standard.categoria
ALTER TABLE mp_standard DROP CONSTRAINT IF EXISTS mp_standard_categoria_check;
ALTER TABLE mp_standard ADD CONSTRAINT mp_standard_categoria_check
  CHECK (categoria IN ('tabuas','barrotes','outros','tabuas_charriot','duplos','costaneiros'));

-- 2) Atualizar mcf_linhas.categoria
UPDATE mcf_linhas SET categoria = 'costaneiros'      WHERE nome LIKE 'Linha aproveitamentos%';
UPDATE mcf_linhas SET categoria = 'duplos'            WHERE nome = 'Linha charriot [Duplos]';
UPDATE mcf_linhas SET categoria = 'tabuas_charriot'   WHERE nome = '[+] Linha charriot [Tábuas]';
UPDATE mcf_linhas SET categoria = NULL                WHERE nome IN ('[-] Linha PSY', '[-] Linha Aprov - Sobras');
-- Principal T1/T3 + Madeira 2ª: já estão como 'tabuas' ✔
-- Charriot [B]: já está como 'barrotes' ✔
