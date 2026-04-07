// Importa MP standard.xlsx → tabela mp_standard no Supabase.
// Uso: node scripts/import_mp_standard.js
//
// Requer: SUPABASE_URL e SUPABASE_SERVICE_KEY em .env
// npm i xlsx @supabase/supabase-js dotenv

import 'dotenv/config';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const MP_PATH = '\\\\172.16.2.100\\Arquivo\\Direcao Producao\\MP standard.xlsx';
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const wb = XLSX.readFile(MP_PATH);
const ws = wb.Sheets['Listagem'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 2 }); // começa na linha 3

function parseDims(ref) {
  // "1200x98x15" → {c:1200, l:98, e:15}
  const m = String(ref || '').match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i);
  if (!m) return null;
  return { c: +m[1], l: +m[2], e: +m[3] };
}

const records = [];
for (const r of rows) {
  const [ , prodConv, , prodStock, , pecas ] = r;
  if (!prodStock) continue;
  const d = parseDims(prodStock);
  if (!d) continue;
  records.push({
    produto_conversao: prodConv || null,
    produto_stock: prodStock,
    comprimento: d.c,
    largura: d.l,
    espessura: d.e,
    pecas_por_malote: pecas || 0,
    categoria: 'tabuas',
  });
}

console.log(`A inserir ${records.length} produtos...`);
const { error } = await supa.from('mp_standard').upsert(records, { onConflict: 'produto_conversao,produto_stock' });
if (error) { console.error(error); process.exit(1); }
console.log('✓ MP standard importado');
