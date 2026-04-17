/**
 * Extrai produtos únicos do histórico MCF (sheet "MCF data") e popula mp_standard.
 * Critério: produto com ≥ 2 registos (exclui erros pontuais).
 * Só insere produtos NOVOS (não altera existentes).
 *
 * Uso: node scripts/import_produtos_historico.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFile } from 'fs/promises';
const XLSX = await import('xlsx');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// 1) Ler histórico do Excel
// ============================================================
const buf = await readFile('C:/Users/Goncalo.Barata/Desktop/App stocks/reference/Report diário produção.xlsm');
const wb = XLSX.read(buf, { type: 'buffer' });
const ws = wb.Sheets['MCF data'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, range: 'A1:AZ10010' });

// Mapping line code -> categoria
const codeToCat = {
  '01.1': 'tabuas',           // Linha principal
  '01.2': 'tabuas',           // Madeira de 2ª
  '02.1': 'barrotes',         // Charriot [B]
  '02.2': 'tabuas_charriot',  // Charriot [Tábuas]
  '02.3': 'duplos',           // Charriot [Duplos]
  '03.1': 'costaneiros',      // Aproveitamentos L01
  '03.2': 'costaneiros',      // Aproveitamentos L02
  '04':   null,               // PSY — skip (uses tabuas + tabuas_charriot filter)
  '05':   null,               // Traçador — skip
};

// Parse SKU "CxLxE"
function parseSKU(sku) {
  if (!sku) return null;
  const m = String(sku).match(/^(\d+)x(\d+)x(\d+)$/);
  if (!m) return null;
  return { comp: +m[1], larg: +m[2], esp: +m[3] };
}

// Header at row 16 (0-indexed: 15). Data starts row 17 (0-indexed: 16).
// Col Y (24) = Linha produção code
// Col Z (25) = Produto final (SKU)
// Col AM (38) = Qtd/mal (peças por malote)

const prodStats = new Map(); // key = "cat|sku" -> { count, pecas_values[] }

for (let i = 16; i < data.length; i++) {
  const row = data[i];
  if (!row) continue;
  let code = row[24]; // Linha produção
  const produto = row[25]; // Produto final
  const qtdMal = row[38]; // Qtd/mal

  if (!code || !produto) continue;
  code = String(code).trim();
  const sku = String(produto).trim();

  // Normalize codes
  if (code.startsWith('03.1')) code = '03.1';
  else if (code.startsWith('03.2')) code = '03.2';
  else if (code.startsWith('04')) code = '04';

  const cat = codeToCat[code];
  if (cat === undefined || cat === null) continue; // Skip PSY, Traçador, unknown

  const dims = parseSKU(sku);
  if (!dims) continue;

  const key = `${cat}|${sku}`;
  if (!prodStats.has(key)) {
    prodStats.set(key, { cat, sku, dims, count: 0, pecas: [] });
  }
  const entry = prodStats.get(key);
  entry.count++;
  if (qtdMal && !isNaN(Number(qtdMal)) && Number(qtdMal) > 0) {
    entry.pecas.push(Number(qtdMal));
  }
}

// Filter: ≥ 2 registos
const candidates = [...prodStats.values()].filter(e => e.count >= 2);
console.log(`Histórico: ${prodStats.size} produtos distintos, ${candidates.length} com ≥2 registos`);

// ============================================================
// 2) Verificar quais já existem em mp_standard
// ============================================================
const { data: existing } = await supabase.from('mp_standard').select('produto_stock, categoria');
const existingSet = new Set((existing || []).map(p => p.produto_stock));

const toInsert = candidates.filter(c => !existingSet.has(c.sku));
console.log(`Já existem: ${candidates.length - toInsert.length} | Novos a inserir: ${toInsert.length}`);

// ============================================================
// 3) Preparar rows para insert
// ============================================================
function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const rows = toInsert.map(c => ({
  produto_stock: c.sku,
  produto_conversao: null,
  comprimento: c.dims.comp,
  largura: c.dims.larg,
  espessura: c.dims.esp,
  pecas_por_malote: median(c.pecas) || 0,
  categoria: c.cat,
  ativo: true,
}));

// Group by categoria for display
const byCat = {};
for (const r of rows) {
  if (!byCat[r.categoria]) byCat[r.categoria] = [];
  byCat[r.categoria].push(r.produto_stock);
}
for (const [cat, prods] of Object.entries(byCat)) {
  console.log(`\n${cat} (${prods.length} novos):`);
  for (const p of prods.sort()) console.log(`  ${p}`);
}

// ============================================================
// 4) Insert
// ============================================================
if (rows.length === 0) {
  console.log('\nNada a inserir — tudo já existe.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100);
  const { error } = await supabase.from('mp_standard').insert(batch);
  if (error) { console.error(`Batch ${i}:`, error.message); fail += batch.length; }
  else ok += batch.length;
}

console.log(`\n✅ ${ok} produtos inseridos, ${fail} falhados`);

// Verify totals
const { count: total } = await supabase.from('mp_standard').select('*', { count: 'exact', head: true });
const { data: catCounts } = await supabase.rpc('', {}).catch(() => ({}));
// Simple count per categoria
for (const cat of ['tabuas', 'barrotes', 'tabuas_charriot', 'duplos', 'costaneiros', 'outros']) {
  const { count } = await supabase.from('mp_standard').select('*', { count: 'exact', head: true }).eq('categoria', cat);
  console.log(`  ${cat}: ${count}`);
}
console.log(`Total mp_standard: ${total}`);
