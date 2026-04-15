/**
 * Adiciona a coluna data_registo à tabela movimentos.
 * Valor default: a data (sem hora) de criado_em.
 *
 * Uso: node scripts/add_data_registo.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  // Usar rpc para executar SQL raw via service_role
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE movimentos
      ADD COLUMN IF NOT EXISTS data_registo date DEFAULT CURRENT_DATE;

      -- Preencher registos existentes com a data de criado_em
      UPDATE movimentos
      SET data_registo = (criado_em AT TIME ZONE 'Europe/Lisbon')::date
      WHERE data_registo IS NULL;

      -- Criar index para queries por data
      CREATE INDEX IF NOT EXISTS idx_movimentos_data_registo ON movimentos(data_registo);
    `
  });

  if (error) {
    // Se rpc não existir, tentar via REST com SQL direto
    console.log('rpc exec_sql não disponível, a tentar via fetch direto...');
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    const queries = [
      'ALTER TABLE movimentos ADD COLUMN IF NOT EXISTS data_registo date DEFAULT CURRENT_DATE',
      "UPDATE movimentos SET data_registo = (criado_em AT TIME ZONE 'Europe/Lisbon')::date WHERE data_registo IS NULL",
      'CREATE INDEX IF NOT EXISTS idx_movimentos_data_registo ON movimentos(data_registo)',
    ];

    for (const sql of queries) {
      console.log('A executar:', sql.substring(0, 80) + '...');
      const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`Erro: ${res.status}`, body);
        console.log('\n⚠️  Executa manualmente no Supabase SQL Editor:');
        console.log('-----------------------------------------------');
        queries.forEach(q => console.log(q + ';'));
        console.log('-----------------------------------------------');
        return;
      }
    }
    console.log('✅ Coluna data_registo adicionada com sucesso.');
    return;
  }

  console.log('✅ Coluna data_registo adicionada com sucesso.');
}

main().catch(console.error);
