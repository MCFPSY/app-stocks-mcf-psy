-- Adiciona largura/espessura do produto-output à tabela sobras_compat
-- para filtrar o dropdown de produto_origem por cross-section compatível
ALTER TABLE rolaria_sobras_compat ADD COLUMN IF NOT EXISTS output_larg int;
ALTER TABLE rolaria_sobras_compat ADD COLUMN IF NOT EXISTS output_esp int;
