/**
 * Importa targets m³/malote do Excel Aux_benchmark para aux_benchmark.
 * Uso: node scripts/import_aux_benchmark.js
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
const ws = wb.Sheets['Aux_benchmark'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// Row 0: header, rows 1+: data
// Col 0: produto_stock, Col 1: principal, Col 2: charriot, Col 3: aproveitamentos, Col 4: psy
const tipoCol = [null, 'principal', 'charriot', 'aproveitamentos', 'psy'];

const rows = [];
for (let i = 1; i < data.length; i++) {
  const produto = String(data[i][0] || '').trim();
  if (!produto) continue;
  for (let c = 1; c <= 4; c++) {
    const val = data[i][c];
    if (val !== null && val !== undefined && val !== '' && !isNaN(Number(val))) {
      rows.push({
        produto_stock: produto,
        tipo_linha: tipoCol[c],
        target_m3_malote: Number(val),
      });
    }
  }
}

console.log(`A inserir ${rows.length} benchmarks...`);

// Insert in batches
let ok = 0, fail = 0;
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100);
  const { error } = await supabase
    .from('aux_benchmark')
    .upsert(batch, { onConflict: 'produto_stock,tipo_linha' });
  if (error) { console.error(`Batch ${i}:`, error.message); fail += batch.length; }
  else ok += batch.length;
}

console.log(`✅ ${ok} benchmarks ok, ${fail} falhados`);

const { count } = await supabase.from('aux_benchmark').select('*', { count: 'exact', head: true });
console.log(`Total na BD: ${count}`);
