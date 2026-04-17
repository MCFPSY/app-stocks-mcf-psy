/**
 * Importa matriz de compatibilidade de sobras a partir do Excel.
 * Sheet: Tabuas_desperdicios_aux
 * Cada 'x' da matriz → 1 linha em rolaria_sobras_compat (long-form).
 *
 * Uso: node scripts/import_rolaria_sobras.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFile } from 'fs/promises';
const XLSX = await import('xlsx');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const buf = await readFile('C:/Users/Goncalo.Barata/Desktop/App stocks/reference/Report diário produção.xlsm');
const wb = XLSX.read(buf, { type: 'buffer' });
const ws = wb.Sheets['Tabuas_desperdicios_aux'];
// Força range a partir de A1 para garantir col A=idx 0 (o !ref da sheet começa em B3 e baralha os índices)
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, range: 'A1:AZ120' });

// Layout (A1=idx 0):
//   Col A (idx 0): sempre null
//   Col B (idx 1): "Especiais" tag (nalgumas linhas)
//   Col C (idx 2): Produto / "Altura maior/média/menor"
//   Col D (idx 3): Comprimento
//   Col E+ (idx 4+): cross-sections (145x77, 145x22, ...)
//
// Header está na row onde col C = "Produto". Detetamos dinamicamente.

let headerRowIdx = -1;
for (let i = 0; i < data.length; i++) {
  if (data[i] && data[i][2] === 'Produto') { headerRowIdx = i; break; }
}
if (headerRowIdx < 0) { console.error('Header row "Produto" não encontrada'); process.exit(1); }
const headerRow = data[headerRowIdx];

// Cross-sections começam em idx 4
const crossSections = [];  // [{ colIdx, name }]
for (let c = 4; c < headerRow.length; c++) {
  const v = headerRow[c];
  if (v && typeof v === 'string' && v.includes('x')) {
    crossSections.push({ colIdx: c, name: v.trim() });
  }
}
console.log(`Cross-sections detetadas: ${crossSections.length}`);

const rows = [];
for (let i = headerRowIdx + 1; i < data.length; i++) {
  const row = data[i];
  if (!row || row.length === 0) continue;

  const especialTag = row[1];    // col B
  const produto = row[2];         // col C
  const comprimento = row[3];     // col D

  // Parar nas linhas "Altura maior/média/menor"
  if (typeof produto === 'string' && produto.toLowerCase().startsWith('altura')) break;
  if (!produto || comprimento === null || comprimento === undefined) continue;
  if (typeof comprimento !== 'number' && !/^\d+$/.test(String(comprimento))) continue;

  const compNum = Number(comprimento);
  const isEspecial = (typeof especialTag === 'string' && especialTag.toLowerCase().includes('especi'));

  // Parse LxE do produto-output (ex: "1200x95x18" -> larg=95, esp=18)
  const skuStr = String(produto).trim();
  const skuMatch = skuStr.match(/^\d+x(\d+)x(\d+)$/);
  const outLarg = skuMatch ? Number(skuMatch[1]) : null;
  const outEsp = skuMatch ? Number(skuMatch[2]) : null;

  for (const cs of crossSections) {
    const mark = row[cs.colIdx];
    if (typeof mark === 'string' && mark.trim().toLowerCase() === 'x') {
      rows.push({
        cross_section: cs.name,
        comprimento_mm: compNum,
        especial: isEspecial,
        output_larg: outLarg,
        output_esp: outEsp,
      });
    }
  }
}

console.log(`A inserir ${rows.length} entradas de compatibilidade...`);

// Dedup por (cross_section, comprimento_mm) — se o Excel tiver duplicados, mantém a primeira
const seen = new Set();
const unique = [];
for (const r of rows) {
  const k = `${r.cross_section}|${r.comprimento_mm}|${r.output_larg}|${r.output_esp}`;
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(r);
}
console.log(`Depois de dedup: ${unique.length}`);

// Limpar existente para idempotência
await supabase.from('rolaria_sobras_compat').delete().neq('id', '00000000-0000-0000-0000-000000000000');

// Insert em batches
let ok = 0, fail = 0;
for (let i = 0; i < unique.length; i += 200) {
  const batch = unique.slice(i, i + 200);
  const { error } = await supabase.from('rolaria_sobras_compat').insert(batch);
  if (error) { console.error(`Batch ${i}:`, error.message); fail += batch.length; }
  else ok += batch.length;
}
console.log(`✅ ${ok} ok, ${fail} falhados`);

// Sanity check: altura_menor por cross-section
const { data: vMin } = await supabase.from('v_altura_menor').select('*').order('cross_section');
console.log('\nAltura menor por cross-section (MIN computado):');
for (const r of vMin || []) {
  console.log(`  ${r.cross_section.padEnd(10)} → ${r.altura_menor_mm}`);
}

const { count } = await supabase.from('rolaria_sobras_compat').select('*', { count: 'exact', head: true });
console.log(`\nTotal na BD: ${count} linhas de compatibilidade`);
