/**
 * Popula rolaria_gamas + rolaria_matriz_principal.
 * Dados do screenshot da tabela de gamas (4 comprimentos de rolaria).
 *
 * Uso: node scripts/import_rolaria_gamas.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// 1) GAMAS
// ============================================================
// Nota: 2750 mm só tem gamas de charriot (user confirmou)
const gamas = [
  // 2100 mm -----------------------------------------------------
  { nome: '2100 mm - <190mm',       comp_rolaria_mm: 2100, comp_produto_mm: 1000, diam_min_mm:   0, diam_max_mm:  190, categoria: 'principal' },
  { nome: '2100 mm - 191 a 220mm',  comp_rolaria_mm: 2100, comp_produto_mm: 1000, diam_min_mm: 191, diam_max_mm:  220, categoria: 'principal' },
  { nome: '2100 mm - 221 a 250mm',  comp_rolaria_mm: 2100, comp_produto_mm: 1000, diam_min_mm: 221, diam_max_mm:  250, categoria: 'principal' },
  { nome: '2100 mm - >250mm (tábuas/duplos)', comp_rolaria_mm: 2100, comp_produto_mm: 1000, diam_min_mm: 251, diam_max_mm: 9999, categoria: 'charriot_tabuas_duplos' },
  { nome: '2100 mm - >250mm (barrotes)',      comp_rolaria_mm: 2100, comp_produto_mm: 2100, diam_min_mm: 251, diam_max_mm: 9999, categoria: 'charriot_barrotes' },

  // 2500 mm -----------------------------------------------------
  { nome: '2500 mm - <180mm',       comp_rolaria_mm: 2500, comp_produto_mm: 1200, diam_min_mm:   0, diam_max_mm:  180, categoria: 'principal' },
  { nome: '2500 mm - 181 a 210mm',  comp_rolaria_mm: 2500, comp_produto_mm: 1200, diam_min_mm: 181, diam_max_mm:  210, categoria: 'principal' },
  { nome: '2500 mm - 211 a 240mm',  comp_rolaria_mm: 2500, comp_produto_mm: 1200, diam_min_mm: 211, diam_max_mm:  240, categoria: 'principal' },
  { nome: '2500 mm - 241 a 280mm',  comp_rolaria_mm: 2500, comp_produto_mm: 1200, diam_min_mm: 241, diam_max_mm:  280, categoria: 'principal' },
  { nome: '2500 mm - >280mm (tábuas/duplos)', comp_rolaria_mm: 2500, comp_produto_mm: 1200, diam_min_mm: 281, diam_max_mm: 9999, categoria: 'charriot_tabuas_duplos' },
  { nome: '2500 mm - >280mm (barrotes)',      comp_rolaria_mm: 2500, comp_produto_mm: 2500, diam_min_mm: 281, diam_max_mm: 9999, categoria: 'charriot_barrotes' },

  // 2600 mm -----------------------------------------------------
  { nome: '2600 mm - <180mm',       comp_rolaria_mm: 2600, comp_produto_mm: 800,  diam_min_mm:   0, diam_max_mm:  180, categoria: 'principal' },
  { nome: '2600 mm - 181 a 210mm',  comp_rolaria_mm: 2600, comp_produto_mm: 800,  diam_min_mm: 181, diam_max_mm:  210, categoria: 'principal' },
  { nome: '2600 mm - 211 a 260mm',  comp_rolaria_mm: 2600, comp_produto_mm: 800,  diam_min_mm: 211, diam_max_mm:  260, categoria: 'principal' },
  { nome: '2600 mm - >260mm (tábuas/duplos)', comp_rolaria_mm: 2600, comp_produto_mm: 800,  diam_min_mm: 261, diam_max_mm: 9999, categoria: 'charriot_tabuas_duplos' },
  { nome: '2600 mm - >260mm (barrotes)',      comp_rolaria_mm: 2600, comp_produto_mm: 2600, diam_min_mm: 261, diam_max_mm: 9999, categoria: 'charriot_barrotes' },

  // 2750 mm ----------------------------------------------------- (só charriot)
  { nome: '2750 mm - 231 a 260mm (tábuas/duplos)', comp_rolaria_mm: 2750, comp_produto_mm: 800, diam_min_mm: 231, diam_max_mm:  260, categoria: 'charriot_tabuas_duplos' },
  { nome: '2750 mm - >260mm (barrotes)',           comp_rolaria_mm: 2750, comp_produto_mm: 2750, diam_min_mm: 261, diam_max_mm: 9999, categoria: 'charriot_barrotes' },
];

console.log(`A inserir ${gamas.length} gamas...`);
const { data: gamasRes, error: gamaErr } = await supabase
  .from('rolaria_gamas')
  .upsert(gamas.map(g => ({ ...g, ativo: true })), { onConflict: 'nome' })
  .select();

if (gamaErr) { console.error('Erro gamas:', gamaErr.message); process.exit(1); }
console.log(`✅ ${gamasRes.length} gamas inseridas/atualizadas`);

// Mapa nome->id para usar na matriz
const gamaId = Object.fromEntries(gamasRes.map(g => [g.nome, g.id]));

// ============================================================
// 2) MATRIZ PRINCIPAL — lookup (comp_produto, L, E, [costaneiro]) -> gama
// ============================================================
// Dados: apenas gamas "principal" (charriot não passa aqui)
const matriz = [
  // 2100 mm -----------------------------------------------------
  { comp_produto_mm: 1000, larg_min:  80, larg_max:  99, esp_max: 25, costaneiro_esp_min: null, costaneiro_esp_max: null, gama_nome: '2100 mm - <190mm' },
  { comp_produto_mm: 1000, larg_min: 100, larg_max: 120, esp_max: 22, costaneiro_esp_min: null, costaneiro_esp_max: null, gama_nome: '2100 mm - 191 a 220mm' },
  { comp_produto_mm: 1000, larg_min: 121, larg_max: 145, esp_max: 22, costaneiro_esp_min: null, costaneiro_esp_max: null, gama_nome: '2100 mm - 221 a 250mm' },

  // 2500 mm -----------------------------------------------------
  { comp_produto_mm: 1200, larg_min:  90, larg_max:  95, esp_max: 22, costaneiro_esp_min: null, costaneiro_esp_max: null, gama_nome: '2500 mm - <180mm' },
  { comp_produto_mm: 1200, larg_min:  96, larg_max: 100, esp_max: 25, costaneiro_esp_min: null, costaneiro_esp_max: null, gama_nome: '2500 mm - 181 a 210mm' },
  { comp_produto_mm: 1200, larg_min: 101, larg_max: 144, esp_max: 21, costaneiro_esp_min: null, costaneiro_esp_max: null, gama_nome: '2500 mm - 211 a 240mm' },
  { comp_produto_mm: 1200, larg_min: 145, larg_max: 150, esp_max: 22, costaneiro_esp_min:  70,  costaneiro_esp_max:  90, gama_nome: '2500 mm - 241 a 280mm' },
  { comp_produto_mm: 1200, larg_min: 145, larg_max: 150, esp_max: 22, costaneiro_esp_min:  91,  costaneiro_esp_max: 100, gama_nome: '2500 mm - 241 a 280mm' },

  // 2600 mm -----------------------------------------------------
  { comp_produto_mm:  800, larg_min:  80, larg_max:  99, esp_max: 20, costaneiro_esp_min: null, costaneiro_esp_max: null, gama_nome: '2600 mm - <180mm' },
  { comp_produto_mm:  800, larg_min: 100, larg_max: 145, esp_max: 22, costaneiro_esp_min:  70,  costaneiro_esp_max:  90, gama_nome: '2600 mm - 181 a 210mm' },
  { comp_produto_mm:  800, larg_min: 100, larg_max: 145, esp_max: 22, costaneiro_esp_min:  91,  costaneiro_esp_max: 100, gama_nome: '2600 mm - 211 a 260mm' },
];

const matrizRows = matriz.map(m => {
  const id = gamaId[m.gama_nome];
  if (!id) throw new Error(`Gama não encontrada: ${m.gama_nome}`);
  const { gama_nome, ...rest } = m;
  return { ...rest, gama_id: id };
});

console.log(`A inserir ${matrizRows.length} linhas na matriz principal...`);
// Limpar matriz existente (idempotência completa)
await supabase.from('rolaria_matriz_principal').delete().neq('id', '00000000-0000-0000-0000-000000000000');
const { error: matErr } = await supabase.from('rolaria_matriz_principal').insert(matrizRows);
if (matErr) { console.error('Erro matriz:', matErr.message); process.exit(1); }
console.log(`✅ ${matrizRows.length} linhas na matriz principal inseridas`);

// Verify
const { count: gCount } = await supabase.from('rolaria_gamas').select('*', { count: 'exact', head: true });
const { count: mCount } = await supabase.from('rolaria_matriz_principal').select('*', { count: 'exact', head: true });
console.log(`Total na BD: ${gCount} gamas · ${mCount} linhas matriz`);
