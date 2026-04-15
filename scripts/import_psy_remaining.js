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
const ws = wb.Sheets['PSY data'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const headerRow = data[2];

// Deduplicate pallet types (trim whitespace)
const seen = new Set();
const palletTypes = [];
for (let j = 11; j < headerRow.length; j++) {
  const raw = String(headerRow[j] || '').trim();
  if (raw && !raw.startsWith('Horas') && !raw.startsWith('Justifica') && !raw.startsWith('Manuten')) {
    if (!seen.has(raw)) { seen.add(raw); palletTypes.push(raw); }
  }
}
console.log(`Unique pallet types after dedup: ${palletTypes.length}`);

// Clean lines (remove invalid entries like dates)
const validLines = ['Bancadas','Linha 0','Linha 01','Linha 02','Linha 03','Linha 04','Linha 05','Linha 06','Linha 07','Linha 08','Linha 0R'];

// Remove bad lines
await supabase.from('psy_linhas').delete().not('nome', 'in', `(${validLines.join(',')})`);
console.log('Cleaned invalid lines');

// Re-insert all palettes one by one
let ok = 0, skip = 0;
for (const nome of palletTypes) {
  const { error } = await supabase.from('psy_produtos').upsert({ nome, ativo: true }, { onConflict: 'nome' });
  if (error) { skip++; } else { ok++; }
}
console.log(`✅ ${ok} tipos ok, ${skip} skipped`);

// Count totals
const { count: lCount } = await supabase.from('psy_linhas').select('*', { count: 'exact', head: true });
const { count: pCount } = await supabase.from('psy_produtos').select('*', { count: 'exact', head: true });
console.log(`\nTotal linhas: ${lCount}`);
console.log(`Total produtos: ${pCount}`);
