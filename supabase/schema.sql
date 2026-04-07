-- =========================================================
-- App Stocks MCF + PSY — Esquema Supabase
-- =========================================================

-- Extensões
create extension if not exists "uuid-ossp";

-- =========================================================
-- PROFILES (ligado ao auth.users)
-- =========================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text unique,
  perfil text not null check (perfil in ('operador','contabilista','admin_producao','admin')),
  criado_em timestamptz default now()
);

-- =========================================================
-- MP_STANDARD (tabela de normalização de produtos)
-- Vem do ficheiro "MP standard.xlsx"
-- =========================================================
create table if not exists mp_standard (
  id uuid primary key default uuid_generate_v4(),
  produto_conversao text,         -- o que a produção escreve (pode ser NULL se já é o stock)
  produto_stock text not null,    -- referência oficial (ex: 1200x98x15)
  comprimento int not null,       -- mm
  largura int not null,           -- mm
  espessura int not null,         -- mm
  pecas_por_malote int not null,
  categoria text not null default 'tabuas' check (categoria in ('tabuas','barrotes','outros')),
  ativo boolean default true,
  unique(produto_conversao, produto_stock)
);
create index on mp_standard(produto_stock);
create index on mp_standard(produto_conversao);

-- =========================================================
-- MOVIMENTOS (append-only, fonte da verdade do stock)
-- =========================================================
create table if not exists movimentos (
  id uuid primary key default uuid_generate_v4(),
  tipo text not null check (tipo in ('entrada_producao','transferencia','ajuste_entrada','ajuste_saida','inventario')),
  empresa text not null check (empresa in ('MCF','PSY')),
  empresa_destino text check (empresa_destino in ('MCF','PSY')), -- só para transferências
  produto_stock text not null references mp_standard(produto_stock),
  malotes numeric not null,
  pecas_por_malote int not null,
  total_pecas numeric generated always as (malotes * pecas_por_malote) stored,
  m3 numeric not null,
  fornecedor text check (fornecedor in ('Serbul','Lamelas','FiliCoelho','DRA')), -- só para ajuste_entrada
  justificacao text,
  operador_id uuid not null references profiles(id),
  incerteza boolean default false,
  duvida_resolvida boolean default true, -- false se veio com incerteza e ainda não foi validada
  estornado boolean default false,
  estorno_de uuid references movimentos(id),
  criado_em timestamptz default now()
);
create index on movimentos(empresa, criado_em desc);
create index on movimentos(produto_stock);
create index on movimentos(duvida_resolvida) where duvida_resolvida = false;

-- =========================================================
-- PEDIDOS DE TRANSFERÊNCIA
-- =========================================================
create table if not exists pedidos (
  id uuid primary key default uuid_generate_v4(),
  empresa_pede text not null check (empresa_pede in ('MCF','PSY')),
  produto_stock text not null references mp_standard(produto_stock),
  malotes numeric not null,
  solicitante_id uuid not null references profiles(id),
  estado text not null default 'pendente' check (estado in ('pendente','cumprido','cancelado')),
  movimento_id uuid references movimentos(id), -- preenchido quando cumprido
  criado_em timestamptz default now(),
  resolvido_em timestamptz
);
create index on pedidos(estado) where estado = 'pendente';

-- =========================================================
-- CONTABILIZAÇÃO (marca dias como lançados no software interno)
-- =========================================================
create table if not exists contabilizacao (
  id uuid primary key default uuid_generate_v4(),
  data date not null,
  empresa text not null check (empresa in ('MCF','PSY')),
  contabilista_id uuid not null references profiles(id),
  marcado_em timestamptz default now(),
  unique(data, empresa)
);

-- =========================================================
-- VIEW: stock atual (soma de movimentos)
-- =========================================================
create or replace view v_stock as
select
  produto_stock,
  empresa,
  sum(case
    when tipo='entrada_producao' and not estornado then malotes
    when tipo='ajuste_entrada' and not estornado then malotes
    when tipo='ajuste_saida' and not estornado then -malotes
    when tipo='transferencia' and empresa_destino != empresa and not estornado then -malotes
    when tipo='inventario' and not estornado then malotes
    else 0
  end) as malotes,
  sum(case
    when tipo='entrada_producao' and not estornado then m3
    when tipo='ajuste_entrada' and not estornado then m3
    when tipo='ajuste_saida' and not estornado then -m3
    when tipo='transferencia' and empresa_destino != empresa and not estornado then -m3
    else 0
  end) as m3
from movimentos
where duvida_resolvida = true
group by produto_stock, empresa;

-- =========================================================
-- RLS (row level security)
-- =========================================================
alter table profiles enable row level security;
alter table mp_standard enable row level security;
alter table movimentos enable row level security;
alter table pedidos enable row level security;
alter table contabilizacao enable row level security;

-- Todos os autenticados podem ler
create policy "read_all_auth" on profiles for select to authenticated using (true);
create policy "read_all_auth" on mp_standard for select to authenticated using (true);
create policy "read_all_auth" on movimentos for select to authenticated using (true);
create policy "read_all_auth" on pedidos for select to authenticated using (true);
create policy "read_all_auth" on contabilizacao for select to authenticated using (true);

-- Inserts de movimentos: operador, admin_producao, admin
create policy "insert_movimentos" on movimentos for insert to authenticated
  with check (exists (select 1 from profiles where id=auth.uid() and perfil in ('operador','admin_producao','admin')));

-- Pedidos: todos os autenticados podem inserir
create policy "insert_pedidos" on pedidos for insert to authenticated with check (true);

-- Contabilização: só contabilistas e admins
create policy "insert_contab" on contabilizacao for insert to authenticated
  with check (exists (select 1 from profiles where id=auth.uid() and perfil in ('contabilista','admin')));

-- Admins podem tudo nas tabelas mp_standard e profiles
create policy "admin_mp" on mp_standard for all to authenticated
  using (exists (select 1 from profiles where id=auth.uid() and perfil='admin'));
