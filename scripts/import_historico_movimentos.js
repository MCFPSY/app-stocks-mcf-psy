/**
 * Importa registos históricos MCF (sheet "MCF data") + PSY (sheet "PSY data")
 * do Report diário produção.xlsm como movimentos na nossa BD.
 *
 * Idempotente: apaga todos os movimentos com justificacao='import histórico xlsm' antes.
 *
 * Uso: node scripts/import_historico_movimentos.js [--limit N]
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFile } from 'fs/promises';
import { computeRolariaPerEntry, computeWeeklyFallbackGama } from '../src/rolaria.js';
const XLSX = await import('xlsx');

const LIMIT = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : Infinity;

const MARKER = 'import histórico xlsm';
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// Lookups
// ============================================================
console.log('A carregar lookups...');
const [linhasRes, mpRes, psyLinhasRes, psyProdutosRes, gamasRes, matrizRes, configRes, profilesRes] = await Promise.all([
  supabase.from('mcf_linhas').select('*').eq('ativo', true),
  supabase.from('mp_standard').select('produto_stock, comprimento, largura, espessura, pecas_por_malote').eq('ativo', true),
  supabase.from('psy_linhas').select('nome').eq('ativo', true),
  supabase.from('psy_produtos').select('nome').eq('ativo', true),
  supabase.from('rolaria_gamas').select('*').eq('ativo', true),
  supabase.from('rolaria_matriz_principal').select('*'),
  supabase.from('consumo_config').select('valor').eq('chave', 'ratio_ton_m3').maybeSingle(),
  supabase.from('profiles').select('id, nome, perfil').eq('perfil', 'admin').limit(1),
]);

const admin = profilesRes.data?.[0];
if (!admin) { console.error('Sem admin configurado'); process.exit(1); }
console.log(`Operador: ${admin.nome} (${admin.id})`);

const linhas = linhasRes.data || [];
const linhaSet = new Set(linhas.map(l => l.nome));
const mpMap = Object.fromEntries((mpRes.data || []).map(p => [p.produto_stock, p]));
const psyLinhaSet = new Set((psyLinhasRes.data || []).map(l => l.nome));
const psyProdSet = new Set((psyProdutosRes.data || []).map(p => p.nome));

const ratio = Number(configRes.data?.valor) || 2.129925;
const rolariaOpts = {
  ratio, gamas: gamasRes.data || [], matriz: matrizRes.data || [],
  linhas, mp: mpRes.data || [],
};

// ============================================================
// Limpeza de imports anteriores
// ============================================================
console.log('\nA apagar imports anteriores (se existirem)...');
const { count: prevCount } = await supabase.from('movimentos').select('*', { count: 'exact', head: true }).eq('justificacao', MARKER);
console.log(`Movimentos com marker anterior: ${prevCount}`);
if (prevCount > 0) {
  const { error } = await supabase.from('movimentos').delete().eq('justificacao', MARKER);
  if (error) { console.error('Erro apagar:', error.message); process.exit(1); }
  console.log(`✅ Apagados ${prevCount}`);
}

// ============================================================
// Mapping de linhas Excel → mcf_linhas
// ============================================================
function mapMcfLinha(code, turno) {
  if (!code) return null;
  const c = String(code).trim();
  const t = (turno || '').trim();
  if (c.startsWith('01.1')) return t ? `Linha principal ${t}` : null;
  if (c.startsWith('01.2')) return t ? `[+] Madeira de 2ª ${t}` : null;
  if (c.startsWith('02.1')) return 'Linha charriot [B]';
  if (c.startsWith('02.2')) return '[+] Linha charriot [Tábuas]';
  if (c.startsWith('02.3')) return 'Linha charriot [Duplos]';
  if (c === '03.1.1') return t ? `Linha aproveitamentos ${t}` : null;
  if (c === '03.1.2') return t ? `[+] Madeira de 2ª Aprov ${t}` : null;
  if (c.startsWith('03.1')) return t ? `Linha aproveitamentos ${t}` : null;
  if (c === '03.2.1') return t ? `Linha aproveitamentos ${t} (B)` : null;
  if (c === '03.2.2') return t ? `[+] Madeira de 2ª Aprov ${t} (B)` : null;
  if (c.startsWith('03.2')) return t ? `Linha aproveitamentos ${t} (B)` : null;
  if (c.startsWith('04')) return '[-] Linha PSY';
  if (c === '05') return '[-] Linha Aprov - Sobras';
  return null;
}

// ============================================================
// MCF data
// ============================================================
console.log('\nA ler sheet MCF data...');
const buf = await readFile('C:/Users/Goncalo.Barata/Desktop/App stocks/reference/Report diário produção.xlsm');
const wb = XLSX.read(buf, { type: 'buffer' });
const mcfData = XLSX.utils.sheet_to_json(wb.Sheets['MCF data'], { header: 1, defval: null });

// Encontrar header row (tem "Dia" na coluna 6)
let mcfHeaderIdx = mcfData.findIndex(r => r && r[5] === 'Dia' && r[23] === 'Turno');
if (mcfHeaderIdx < 0) { console.error('Header MCF não encontrado'); process.exit(1); }
console.log(`Header MCF em idx ${mcfHeaderIdx}`);

// Parse Excel serial date → YYYY-MM-DD
function excelDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  if (typeof val === 'number') {
    // Excel epoch: 1899-12-30
    const d = new Date(Date.UTC(1899, 11, 30) + val * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

const mcfMovimentos = [];
let skippedMcf = { noLinha: 0, noProd: 0, noData: 0, noQty: 0, linhaNaoMap: 0, linhaInvalida: 0, prodInvalido: 0 };

for (let i = mcfHeaderIdx + 1; i < mcfData.length && mcfMovimentos.length < LIMIT; i++) {
  const r = mcfData[i]; if (!r) continue;
  const data = excelDate(r[5]);                          // col 6 (idx 5)
  const turno = r[23];                                    // col 24
  const linhaCode = r[24] != null ? String(r[24]).trim() : null; // col 25
  const produto = r[25] ? String(r[25]).trim() : null;  // col 26
  const pecasPorMal = Number(r[38]) || 0;                 // col 39
  const malotes = Number(r[44]) || 0;                     // col 45
  const m3 = Number(r[46]) || 0;                          // col 47

  if (!data) { skippedMcf.noData++; continue; }
  if (!linhaCode) { skippedMcf.noLinha++; continue; }
  if (!produto) { skippedMcf.noProd++; continue; }
  if (malotes <= 0 || m3 <= 0) { skippedMcf.noQty++; continue; }

  const linhaNome = mapMcfLinha(linhaCode, turno);
  if (!linhaNome) { skippedMcf.linhaNaoMap++; continue; }
  if (!linhaSet.has(linhaNome)) { skippedMcf.linhaInvalida++; continue; }
  if (!mpMap[produto]) { skippedMcf.prodInvalido++; continue; }

  // Derive turno from linha (igual à app)
  const turnoFromLinha = (() => {
    const m = linhaNome.match(/\b(T[123])\b/);
    return m ? m[1] : null;
  })();

  mcfMovimentos.push({
    tipo: 'entrada_producao', empresa: 'MCF',
    produto_stock: produto, malotes, pecas_por_malote: pecasPorMal || 1, m3,
    operador_id: admin.id, incerteza: false, duvida_resolvida: true,
    data_registo: data, linha: linhaNome, turno: turnoFromLinha,
    justificacao: MARKER,
  });
}

console.log(`\nMCF: ${mcfMovimentos.length} movimentos a importar`);
console.log('  Skipped:', skippedMcf);

// Compute rolaria per week
console.log('\nA computar rolaria (agrupado por semana)...');
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return `${x.getUTCFullYear()}-W${String(Math.ceil(((x - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

const byWeek = new Map();
for (const m of mcfMovimentos) {
  const wk = isoWeek(new Date(m.data_registo + 'T00:00:00Z'));
  if (!byWeek.has(wk)) byWeek.set(wk, []);
  byWeek.get(wk).push(m);
}

for (const [wk, weekMovs] of byWeek) {
  const fallback = computeWeeklyFallbackGama(weekMovs, rolariaOpts);
  const rolariaMap = computeRolariaPerEntry(weekMovs, { ...rolariaOpts, weeklyFallbackGama: fallback });
  for (let i = 0; i < weekMovs.length; i++) {
    const info = rolariaMap.get(i);
    if (info?.tons > 0) weekMovs[i].rolaria_tons = +info.tons.toFixed(3);
    if (info?.gama) weekMovs[i].rolaria_gama = info.gama;
  }
}
console.log(`Semanas processadas: ${byWeek.size}`);

// ============================================================
// PSY data
// ============================================================
console.log('\nA ler sheet PSY data...');
const psyData = XLSX.utils.sheet_to_json(wb.Sheets['PSY data'], { header: 1, defval: null });
const psyHeader = psyData[2]; // R3 é header (verified earlier)

const psyProdCols = [];
for (let c = 11; c < psyHeader.length; c++) {
  const name = psyHeader[c];
  if (name && psyProdSet.has(String(name).trim())) {
    psyProdCols.push({ idx: c, nome: String(name).trim() });
  }
}
console.log(`PSY cols-produto: ${psyProdCols.length}`);

const psyMovimentos = [];
let skippedPsy = { noLinha: 0, noTurno: 0, noData: 0, linhaInvalida: 0 };

for (let i = 3; i < psyData.length; i++) {
  const r = psyData[i]; if (!r) continue;
  const data = excelDate(r[3]);
  const linha = r[4] ? String(r[4]).trim() : null;
  const turno = r[7] ? String(r[7]).trim() : null;

  if (!data) { skippedPsy.noData++; continue; }
  if (!linha) { skippedPsy.noLinha++; continue; }
  if (!turno) { skippedPsy.noTurno++; continue; }
  if (!psyLinhaSet.has(linha)) { skippedPsy.linhaInvalida++; continue; }

  for (const p of psyProdCols) {
    const v = Number(r[p.idx]) || 0;
    if (v <= 0 || v > 100000) continue;
    psyMovimentos.push({
      tipo: 'entrada_producao', empresa: 'PSY',
      produto_stock: p.nome, malotes: v, pecas_por_malote: 1, m3: 0,
      operador_id: admin.id, incerteza: false, duvida_resolvida: true,
      data_registo: data, linha, turno,
      justificacao: MARKER,
    });
    if (mcfMovimentos.length + psyMovimentos.length >= LIMIT) break;
  }
  if (mcfMovimentos.length + psyMovimentos.length >= LIMIT) break;
}

console.log(`\nPSY: ${psyMovimentos.length} movimentos a importar`);
console.log('  Skipped:', skippedPsy);

// ============================================================
// Inserção em batch
// ============================================================
const all = [...mcfMovimentos, ...psyMovimentos];
console.log(`\nTotal a inserir: ${all.length}`);

let ok = 0, fail = 0;
const batchSize = 500;
for (let i = 0; i < all.length; i += batchSize) {
  const batch = all.slice(i, i + batchSize);
  const { error } = await supabase.from('movimentos').insert(batch);
  if (error) { console.error(`Batch ${i}:`, error.message); fail += batch.length; }
  else ok += batch.length;
  if ((i / batchSize) % 5 === 0) process.stdout.write(`${ok}/${all.length}  `);
}
console.log(`\n\n✅ ${ok} inseridos, ${fail} falhados`);
