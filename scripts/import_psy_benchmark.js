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

// Load psy_produtos + psy_linhas sets
const { data: prodRows } = await supabase.from('psy_produtos').select('nome').eq('ativo', true);
const produtoSet = new Set((prodRows || []).map(p => p.nome));
const { data: linhaRows } = await supabase.from('psy_linhas').select('nome').eq('ativo', true);
const linhaSet = new Set((linhaRows || []).map(l => l.nome));
console.log(`psy_produtos ativos: ${produtoSet.size} · psy_linhas ativas: ${linhaSet.size}`);

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

const SKIP_PRODUTOS = new Set(['Total', 'Totals', 'TOTAL']);
const SANE_MAX = 100000;

// Passo 1: agregar por (data, linha, turno, produto) — soma de todas as rows
// que partilhem essa chave (múltiplos registos no mesmo turno).
const turnoTotals = new Map(); // "data|linha|turno|produto" -> sum

for (let i = 3; i < data.length; i++) {
  const row = data[i];
  if (!row) continue;
  const linha = row[4]; const turno = row[7]; const dia = row[3];  // cols E, H, D
  if (!linha || !turno || !dia) continue;
  const linhaStr = String(linha).trim();
  if (!linhaSet.has(linhaStr)) continue;
  const turnoStr = String(turno).trim();
  const diaStr = String(dia);

  for (const p of prodCols) {
    if (SKIP_PRODUTOS.has(p.nome)) continue;
    const v = row[p.idx];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!isFinite(n) || n <= 0 || n > SANE_MAX) continue;
    const key = `${diaStr}|${linhaStr}|${turnoStr}|${p.nome}`;
    turnoTotals.set(key, (turnoTotals.get(key) || 0) + n);
  }
}

// Passo 2: máximo por (linha, produto) sobre os totais de turno
for (const [key, qtd] of turnoTotals) {
  const [, linha, , produto] = key.split('|');
  const k = `${linha}|${produto}`;
  const prev = maxMap.get(k) || 0;
  if (qtd > prev) maxMap.set(k, qtd);
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
