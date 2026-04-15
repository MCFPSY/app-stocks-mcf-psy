/**
 * Importa catálogo PSY do Excel para Supabase:
 * - Linhas de produção → psy_linhas
 * - Tipos de paletes → psy_produtos
 *
 * Uso: node scripts/import_psy_catalog.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFile } from 'fs/promises';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// We'll read the Excel with the xlsx library (already in dependencies)
const XLSX = await import('xlsx');

async function main() {
  console.log('A ler Excel...');
  const buf = await readFile('C:/Users/Goncalo.Barata/Desktop/App stocks/reference/Report diário produção.xlsm');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['PSY data'];
  if (!ws) { console.error('Sheet "PSY data" não encontrada'); return; }

  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Row 3 (index 2) has headers
  const headerRow = data[2];
  if (!headerRow) { console.error('Header row not found'); return; }

  // --- Extract production lines (column E = index 4) ---
  const lines = new Set();
  for (let i = 3; i < data.length; i++) {
    const line = String(data[i][4] || '').trim();
    if (line && !line.includes('202') && line.length < 30) lines.add(line);
  }
  const sortedLines = [...lines].sort();
  console.log(`\nLinhas de produção encontradas (${sortedLines.length}):`);
  sortedLines.forEach(l => console.log(`  ${l}`));

  // --- Extract pallet types (columns 11+ in header row) ---
  const palletTypes = [];
  for (let j = 11; j < headerRow.length; j++) {
    const name = String(headerRow[j] || '').trim();
    if (name && !name.startsWith('Horas') && !name.startsWith('Justifica') && !name.startsWith('Manuten')) {
      palletTypes.push(name);
    }
  }
  console.log(`\nTipos de paletes encontrados: ${palletTypes.length}`);
  palletTypes.slice(0, 10).forEach(p => console.log(`  ${p}`));
  console.log('  ...');

  // --- Insert lines ---
  console.log('\nA inserir linhas de produção...');
  const lineRows = sortedLines.map(nome => ({ nome, ativo: true }));
  const { data: insertedLines, error: errL } = await supabase
    .from('psy_linhas')
    .upsert(lineRows, { onConflict: 'nome' })
    .select();
  if (errL) console.error('Erro linhas:', errL.message);
  else console.log(`✅ ${insertedLines.length} linhas inseridas/atualizadas`);

  // --- Insert pallet types (in batches of 50) ---
  console.log('\nA inserir tipos de paletes...');
  let inserted = 0;
  for (let i = 0; i < palletTypes.length; i += 50) {
    const batch = palletTypes.slice(i, i + 50).map(nome => ({ nome, ativo: true }));
    const { data: ins, error: errP } = await supabase
      .from('psy_produtos')
      .upsert(batch, { onConflict: 'nome' })
      .select();
    if (errP) { console.error(`Erro batch ${i}:`, errP.message); continue; }
    inserted += ins.length;
  }
  console.log(`✅ ${inserted} tipos de paletes inseridos/atualizados`);

  // Also add special types: Antigos, Tampos
  const specials = [{ nome: 'Antigos', ativo: true }, { nome: 'Tampos', ativo: true }];
  await supabase.from('psy_produtos').upsert(specials, { onConflict: 'nome' });
  console.log('✅ Tipos especiais (Antigos, Tampos) adicionados');

  console.log('\nImportação concluída!');
}

main().catch(console.error);
