/**
 * Popula a tabela mcf_linhas com as 11 linhas de produção MCF do Excel Main.
 * Uso: node scripts/import_mcf_linhas.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const linhas = [
  { nome: 'Linha principal T1',          hc: 7, tipo_benchmark: 'principal',       sinal: '+', ordem: 1 },
  { nome: 'Linha principal T3',          hc: 7, tipo_benchmark: 'principal',       sinal: '+', ordem: 2 },
  { nome: 'Linha charriot [B]',          hc: 8, tipo_benchmark: 'charriot',        sinal: '+', ordem: 3 },
  { nome: 'Linha aproveitamentos T1',    hc: 7, tipo_benchmark: 'aproveitamentos', sinal: '+', ordem: 4 },
  { nome: 'Linha aproveitamentos T3',    hc: 7, tipo_benchmark: 'aproveitamentos', sinal: '+', ordem: 5 },
  { nome: 'Linha charriot [Duplos]',     hc: 0, tipo_benchmark: 'charriot',        sinal: '+', ordem: 6 },
  { nome: '[-] Linha PSY',               hc: 2, tipo_benchmark: 'psy',             sinal: '-', ordem: 7 },
  { nome: '[-] Linha Aprov - Sobras',    hc: 1, tipo_benchmark: 'aproveitamentos', sinal: '-', ordem: 8 },
  { nome: '[+] Linha charriot [Tábuas]', hc: 0, tipo_benchmark: 'charriot',        sinal: '+', ordem: 9 },
  { nome: '[+] Madeira de 2ª T1',        hc: 2, tipo_benchmark: 'principal',       sinal: '+', ordem: 10 },
  { nome: '[+] Madeira de 2ª T3',        hc: 2, tipo_benchmark: 'principal',       sinal: '+', ordem: 11 },
];

const { data, error } = await supabase
  .from('mcf_linhas')
  .upsert(linhas.map(l => ({ ...l, ativo: true })), { onConflict: 'nome' })
  .select();

if (error) { console.error('Erro:', error.message); process.exit(1); }
console.log(`✅ ${data.length} linhas MCF inseridas/atualizadas`);

// Also update psy_linhas HC
const psyHc = [
  { nome: 'Linha 01', hc: 10, ordem: 1 },   // T1+T2
  { nome: 'Linha 02', hc: 2,  ordem: 2 },
  { nome: 'Linha 03', hc: 0,  ordem: 3 },
  { nome: 'Linha 04', hc: 1,  ordem: 4 },
  { nome: 'Linha 05', hc: 0,  ordem: 5 },
  { nome: 'Linha 06', hc: 1,  ordem: 6 },
  { nome: 'Linha 07', hc: 2,  ordem: 7 },
  { nome: 'Linha 08', hc: 5,  ordem: 8 },   // T1+T2
  { nome: 'Bancadas', hc: 4,  ordem: 9 },
  { nome: 'Linha 0',  hc: 0,  ordem: 10 },
  { nome: 'Linha 0R', hc: 0,  ordem: 11 },
];
for (const l of psyHc) {
  await supabase.from('psy_linhas').update({ hc: l.hc, ordem: l.ordem }).eq('nome', l.nome);
}
console.log('✅ psy_linhas HC atualizado');
