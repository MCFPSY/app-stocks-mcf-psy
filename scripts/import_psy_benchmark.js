/**
 * Importa targets PSY = máximo histórico de quantidade por (linha, produto)
 * a partir da sheet "PSY data" do Report diário produção.xlsm
 *
 * Uso: node scripts/import_psy_benchmark.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFile } from 'fs/promises';
const XLSX = await import('xlsx');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Load psy_produtos set
const { data: prodRows } = await supabase.from('psy_produtos').select('nome').eq('ativo', true);
const produtoSet = new Set((prodRows || []).map(p => p.nome));
console.log(`psy_produtos ativos: ${produtoSet.size}`);

// Read PSY_data sheet
const buf = await readFile('C:/Users/Goncalo.Barata/Desktop/App stocks/reference/Report diário produção.xlsm');
const wb = XLSX.read(buf, { type: 'buffer' });
const ws = wb.Sheets['PSY data'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// Header at row 3 (0-indexed: 2)
const header = data[2];
if (!header) { console.error('Header row 3 não encontrado'); process.exit(1); }

// Col E (idx 4) = Linha, Col H (idx 7) = Turno
// Product columns start at col 12 (idx 11); match against psy_produtos names
const prodCols = [];
for (let c = 11; c < header.length; c++) {
  const name = header[c];
  if (name && produtoSet.has(String(name).trim())) {
    prodCols.push({ idx: c, nome: String(name).trim() });
  }
}
console.log(`Colunas-produto reconhecidas: ${prodCols.length}`);

// Iterate data rows: for each (linha, produto), track max quantidade
const maxMap = new Map(); // "linha|produto" -> qty

for (let i = 3; i < data.length; i++) {
  const row = data[i];
  if (!row) continue;
  const linha = row[4]; // col E
  if (!linha) continue;
  const linhaStr = String(linha).trim();

  for (const p of prodCols) {
    const v = row[p.idx];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!isFinite(n) || n <= 0) continue;
    const key = `${linhaStr}|${p.nome}`;
    const prev = maxMap.get(key) || 0;
    if (n > prev) maxMap.set(key, n);
  }
}

console.log(`Pares (linha, produto) com registos: ${maxMap.size}`);

// Prepare rows
const rows = [];
for (const [key, qty] of maxMap) {
  const [linha, produto] = key.split('|');
  rows.push({ linha, produto, target_qtd: Math.round(qty) });
}

// Clear existing & bulk insert
console.log('A limpar tabela existente...');
await supabase.from('psy_benchmark').delete().neq('id', '00000000-0000-0000-0000-000000000000');

let ok = 0, fail = 0;
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const { error } = await supabase.from('psy_benchmark').insert(batch);
  if (error) { console.error(`Batch ${i}:`, error.message); fail += batch.length; }
  else ok += batch.length;
}

console.log(`\n✅ ${ok} targets inseridos, ${fail} falhados`);

// Sample top targets
const { data: top } = await supabase.from('psy_benchmark').select('*').order('target_qtd', { ascending: false }).limit(10);
console.log('\nTop 10 targets:');
for (const r of (top || [])) console.log(`  ${r.linha.padEnd(12)} ${r.produto.padEnd(35)} → ${r.target_qtd}`);
