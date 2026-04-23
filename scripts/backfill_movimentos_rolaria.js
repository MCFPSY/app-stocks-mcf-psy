/**
 * Backfill: preenche rolaria_tons + rolaria_gama em movimentos existentes
 * que ainda não tenham os valores. Usa o mesmo algoritmo do submit (src/rolaria.js).
 *
 * Agrupa movimentos por semana ISO para computar o weekly fallback corretamente.
 *
 * Uso: node scripts/backfill_movimentos_rolaria.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { computeRolariaPerEntry, computeWeeklyFallbackGama } from '../src/rolaria.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

const [gamasRes, matrizRes, linhasRes, mpRes, configRes] = await Promise.all([
  supabase.from('rolaria_gamas').select('*').eq('ativo', true),
  supabase.from('rolaria_matriz_principal').select('*'),
  supabase.from('mcf_linhas').select('*').eq('ativo', true).order('ordem'),
  supabase.from('mp_standard').select('produto_stock, comprimento, largura, espessura').eq('ativo', true),
  supabase.from('consumo_config').select('valor').eq('chave', 'ratio_ton_m3').maybeSingle(),
]);

const ratio = Number(configRes.data?.valor) || 2.129925;
const opts = {
  ratio,
  gamas: gamasRes.data || [],
  matriz: matrizRes.data || [],
  linhas: linhasRes.data || [],
  mp: mpRes.data || [],
};

// Fetch all MCF entrada_producao movimentos (paginated)
const allMovs = [];
let offset = 0, batch = 1000;
while (true) {
  const { data } = await supabase.from('movimentos')
    .select('id, linha, turno, data_registo, produto_stock, m3, rolaria_tons, rolaria_gama')
    .eq('tipo', 'entrada_producao').eq('empresa', 'MCF')
    .eq('estornado', false).eq('duvida_resolvida', true)
    .not('linha', 'is', null)
    .order('data_registo').range(offset, offset + batch - 1);
  if (!data?.length) break;
  allMovs.push(...data);
  if (data.length < batch) break;
  offset += batch;
}
console.log(`Total movimentos MCF: ${allMovs.length}`);

// Agrupa por semana ISO
const byWeek = new Map();
for (const m of allMovs) {
  const d = new Date((m.data_registo || '') + 'T00:00:00Z');
  if (isNaN(d)) continue;
  const { year, week } = isoWeek(d);
  const key = `${year}-W${String(week).padStart(2, '0')}`;
  if (!byWeek.has(key)) byWeek.set(key, []);
  byWeek.get(key).push(m);
}
console.log(`Semanas: ${byWeek.size}`);

let updated = 0, skipped = 0;

for (const [weekKey, weekMovs] of byWeek) {
  const fallback = computeWeeklyFallbackGama(weekMovs, opts);
  const rolariaMap = computeRolariaPerEntry(weekMovs, { ...opts, weeklyFallbackGama: fallback });

  const patches = [];
  for (let i = 0; i < weekMovs.length; i++) {
    const m = weekMovs[i];
    const info = rolariaMap.get(i);
    if (!info) continue;
    const needsTons = m.rolaria_tons == null;
    const needsGama = m.rolaria_gama == null;
    if (!needsTons && !needsGama) { skipped++; continue; }
    const patch = { id: m.id };
    if (needsTons && info.tons > 0) patch.rolaria_tons = +info.tons.toFixed(3);
    if (needsGama && info.gama) patch.rolaria_gama = info.gama;
    if (Object.keys(patch).length > 1) patches.push(patch);
  }

  // Batch update
  for (const p of patches) {
    const { id, ...vals } = p;
    const { error } = await supabase.from('movimentos').update(vals).eq('id', id);
    if (error) console.error(`Erro ${id}:`, error.message);
    else updated++;
  }
  process.stdout.write(`${weekKey}: ${patches.length} patches · `);
}
console.log(`\n\n✅ ${updated} atualizados · ${skipped} já preenchidos (skipped)`);
