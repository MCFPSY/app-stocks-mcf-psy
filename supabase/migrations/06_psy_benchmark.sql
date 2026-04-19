-- =========================================================
-- psy_benchmark: target por (linha, produto) para a PSY
-- Target = máximo histórico de quantidade por turno
-- =========================================================

create table if not exists psy_benchmark (
  id uuid primary key default uuid_generate_v4(),
  linha text not null,
  produto text not null,
  target_qtd int not null,
  atualizado_em timestamptz default now(),
  unique(linha, produto)
);

create index if not exists idx_psy_benchmark_linha on psy_benchmark(linha);

alter table psy_benchmark enable row level security;
create policy "read_all_auth" on psy_benchmark for select to authenticated using (true);
create policy "admin_write" on psy_benchmark for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and perfil = 'admin'));
