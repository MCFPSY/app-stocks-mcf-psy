-- =========================================================
-- Consumo Rolaria — Fase 1 (schema)
-- Idempotente. Correr no Supabase SQL Editor.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Config global (key-value, para ratio editável)
-- ---------------------------------------------------------
create table if not exists consumo_config (
  chave text primary key,
  valor numeric not null,
  descricao text,
  atualizado_em timestamptz default now()
);

insert into consumo_config (chave, valor, descricao)
  values ('ratio_ton_m3', 2.129925, 'Toneladas de rolaria por m3 de madeira serrada')
  on conflict (chave) do nothing;

-- ---------------------------------------------------------
-- 2) Catálogo de gamas de rolaria
--    (cada combinação comp+diâmetro que entra na produção)
-- ---------------------------------------------------------
create table if not exists rolaria_gamas (
  id uuid primary key default uuid_generate_v4(),
  nome text not null unique,                 -- e.g. "2100 mm - 191 a 220mm"
  comp_rolaria_mm int not null,              -- 2100, 2500, 2600, 2750
  comp_produto_mm int not null,              -- comp do produto produzido (principal: 1000/1200/800; [B]=comp_rolaria; tábuas/duplos variável)
  diam_min_mm int not null,                  -- inclusivo
  diam_max_mm int not null,                  -- inclusivo (usar 9999 para "sem limite")
  categoria text not null check (categoria in ('principal','charriot_barrotes','charriot_tabuas_duplos')),
  ativo boolean default true,
  criado_em timestamptz default now()
);
create index if not exists idx_rolaria_gamas_comp on rolaria_gamas(comp_rolaria_mm);
create index if not exists idx_rolaria_gamas_cat_comp on rolaria_gamas(categoria, comp_produto_mm);

-- ---------------------------------------------------------
-- 3) Matriz principal — lookup (comp_produto, L, E, [costaneiro_esp]) -> gama
--    Alimenta Linhas principal T1/T3 + Madeira de 2ª
--    Nota: costaneiro_esp_min/max NULL = matches qualquer espessura.
--          Quando há 2 linhas com mesmo (comp, larg, esp) mas
--          costaneiro diferente, o costaneiro da aproveitamentos
--          do mesmo turno desempata.
-- ---------------------------------------------------------
create table if not exists rolaria_matriz_principal (
  id uuid primary key default uuid_generate_v4(),
  comp_produto_mm int not null,              -- 800, 1000, 1200, ...
  larg_min int not null,                     -- inclusivo
  larg_max int not null,                     -- inclusivo
  esp_max int not null,                      -- inclusivo
  costaneiro_esp_min int,                    -- NULL = qualquer
  costaneiro_esp_max int,                    -- NULL = qualquer
  gama_id uuid not null references rolaria_gamas(id) on delete restrict,
  criado_em timestamptz default now()
);
create index if not exists idx_matriz_principal_lookup
  on rolaria_matriz_principal(comp_produto_mm, larg_min, larg_max);

-- ---------------------------------------------------------
-- 5) Matriz de compatibilidade de sobras
--    Long-form da sheet Tabuas_desperdicios_aux.
--    Cada linha = um 'x' da matriz original.
--    altura_menor(L×E) = MIN(comprimento_mm) calculado em runtime.
-- ---------------------------------------------------------
create table if not exists rolaria_sobras_compat (
  id uuid primary key default uuid_generate_v4(),
  cross_section text not null,               -- "LxE" e.g. "90x14"
  comprimento_mm int not null,               -- e.g. 780
  especial boolean default false,            -- tag "Especiais" da matriz
  criado_em timestamptz default now(),
  unique(cross_section, comprimento_mm)
);
create index if not exists idx_sobras_compat_cross on rolaria_sobras_compat(cross_section);

-- View auxiliar: altura_menor por cross-section (MIN de todos os compatíveis)
create or replace view v_altura_menor as
  select cross_section, min(comprimento_mm) as altura_menor_mm
  from rolaria_sobras_compat
  group by cross_section;

-- ---------------------------------------------------------
-- 6) Catálogo-base de produtos origem
--    (SKUs manualmente curados p/ usar em PSY + Aprov-Sobras.
--     As sobras derivadas vivem em movimentos — este catálogo
--     é só o complemento manual.)
-- ---------------------------------------------------------
create table if not exists produtos_origem_base (
  id uuid primary key default uuid_generate_v4(),
  produto_stock text not null unique,        -- e.g. "2500x90x14"
  aplicavel_psy boolean default true,
  aplicavel_aprov_sobras boolean default true,
  ativo boolean default true,
  criado_em timestamptz default now()
);

-- ---------------------------------------------------------
-- 7) Novos campos em movimentos
--    - produto_origem + multiplicador: só preenchidos em linhas sinal='-'
--    - movimento_origem_id: preenchido só em sobras derivadas
--      (apontam ao movimento principal que as gerou)
-- ---------------------------------------------------------
alter table movimentos add column if not exists produto_origem text;
alter table movimentos add column if not exists multiplicador int;
alter table movimentos add column if not exists movimento_origem_id uuid references movimentos(id);

create index if not exists idx_mov_produto_origem on movimentos(produto_origem)
  where produto_origem is not null;
create index if not exists idx_mov_origem_link on movimentos(movimento_origem_id)
  where movimento_origem_id is not null;

-- ---------------------------------------------------------
-- RLS: leitura para todos autenticados, escrita só admin
-- ---------------------------------------------------------
alter table consumo_config              enable row level security;
alter table rolaria_gamas               enable row level security;
alter table rolaria_matriz_principal    enable row level security;
alter table rolaria_sobras_compat       enable row level security;
alter table produtos_origem_base        enable row level security;

create policy "read_all_auth" on consumo_config              for select to authenticated using (true);
create policy "read_all_auth" on rolaria_gamas               for select to authenticated using (true);
create policy "read_all_auth" on rolaria_matriz_principal    for select to authenticated using (true);
create policy "read_all_auth" on rolaria_sobras_compat       for select to authenticated using (true);
create policy "read_all_auth" on produtos_origem_base        for select to authenticated using (true);

create policy "admin_write" on consumo_config              for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and perfil = 'admin'));
create policy "admin_write" on rolaria_gamas               for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and perfil = 'admin'));
create policy "admin_write" on rolaria_matriz_principal    for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and perfil = 'admin'));
create policy "admin_write" on rolaria_sobras_compat       for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and perfil = 'admin'));
create policy "admin_write" on produtos_origem_base        for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and perfil = 'admin'));
