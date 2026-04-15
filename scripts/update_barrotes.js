/**
 * Atualiza a categoria para "barrotes" em todos os registos
 * cujo produto_stock comece por 2000, 2200, 2350 ou 2500.
 *
 * Uso: node scripts/update_barrotes.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY          // service_role para bypass RLS
);

const prefixes = ['2000', '2200', '2350', '2500'];

async function main() {
  console.log('A procurar registos com produto_stock que começa por:', prefixes.join(', '));

  // Buscar todos os registos que correspondem
  let allMatches = [];
  for (const prefix of prefixes) {
    const { data, error } = await supabase
      .from('mp_standard')
      .select('id, produto_stock, categoria')
      .like('produto_stock', `${prefix}%`);

    if (error) {
      console.error(`Erro ao procurar prefix ${prefix}:`, error.message);
      continue;
    }
    if (data.length > 0) allMatches.push(...data);
  }

  if (allMatches.length === 0) {
    console.log('Nenhum registo encontrado.');
    return;
  }

  console.log(`\nEncontrados ${allMatches.length} registos:`);
  allMatches.forEach(r =>
    console.log(`  ${r.produto_stock}  (categoria atual: ${r.categoria})`)
  );

  // Atualizar todos para "barrotes"
  const ids = allMatches.map(r => r.id);
  const { data: updated, error: updateErr } = await supabase
    .from('mp_standard')
    .update({ categoria: 'barrotes' })
    .in('id', ids)
    .select('id, produto_stock, categoria');

  if (updateErr) {
    console.error('\nErro ao atualizar:', updateErr.message);
    return;
  }

  console.log(`\n✅ ${updated.length} registos atualizados para categoria "barrotes".`);
}

main().catch(console.error);
