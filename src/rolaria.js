// Algoritmo de consumo de rolaria — módulo partilhado
// Usado pelo malotes.js (ao submeter, persiste tons + gama)
// e pelo script de backfill.
//
// Input: array de "entries" {linha, turno, produto_stock, m3, data_registo}
//        + lookups (gamas, matriz_principal, linhas, mp, ratio)
// Output: Map<index, { gama: string|null, tons: number, reason: string }>

export function computeRolariaPerEntry(entries, opts) {
  const { ratio, gamas, matriz, linhas, mp, weeklyFallbackGama } = opts;
  const linhaByNome = Object.fromEntries(linhas.map(l => [l.nome, l]));
  const gamaById = Object.fromEntries(gamas.map(g => [g.id, g]));
  const mpMap = {};
  for (const p of mp) mpMap[p.produto_stock] = p;

  function turnoKey(e) { return `${e.data_registo}|${e.turno || ''}`; }
  const isBLine = (nome) => / \(B\)$/.test(nome);

  function lookupMatrizPrincipal(comp, larg, esp, costaneiroEsp) {
    for (const row of matriz) {
      if (row.comp_produto_mm !== comp) continue;
      if (larg < row.larg_min || larg > row.larg_max) continue;
      if (esp > row.esp_max) continue;
      // Filtro de costaneiro: só aplica se conhecido. Se desconhecido,
      // ignora o filtro → primeiro row que matcha (comp, larg, esp) ganha.
      if (costaneiroEsp != null && row.costaneiro_esp_min != null && row.costaneiro_esp_max != null) {
        if (costaneiroEsp < row.costaneiro_esp_min || costaneiroEsp > row.costaneiro_esp_max) continue;
      }
      return gamaById[row.gama_id] || null;
    }
    return null;
  }
  function lookupCharriotGama(comp, categoria) {
    return gamas.find(g => g.comp_rolaria_mm === comp && g.categoria === categoria) || null;
  }

  // Pass 0: costaneiro esp by turno (from aproveitamentos sinal='+')
  const aprovEspPerTurno = new Map();
  for (const e of entries) {
    const linha = linhaByNome[e.linha];
    if (!linha) continue;
    if (linha.tipo_benchmark === 'aproveitamentos' && linha.sinal === '+') {
      const p = mpMap[e.produto_stock];
      if (p) aprovEspPerTurno.set(turnoKey(e), p.espessura);
    }
  }

  // Pass 1: principal + charriot [B]
  const result = new Map();
  const principalGamaPerTurno = new Map();
  const charriotBGamaPerTurno = new Map();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const linha = linhaByNome[e.linha];
    if (!linha) continue;
    const p = mpMap[e.produto_stock];
    const tk = turnoKey(e);

    if (linha.tipo_benchmark === 'principal' && !isBLine(linha.nome)) {
      if (!p) { result.set(i, { gama: null, tons: 0, reason: 'Produto não encontrado' }); continue; }
      const costEsp = aprovEspPerTurno.get(tk) || null;
      const gama = lookupMatrizPrincipal(p.comprimento, p.largura, p.espessura, costEsp);
      result.set(i, {
        gama: gama?.nome || null, tons: Number(e.m3) * ratio,
        reason: gama ? null : 'Sem match na matriz'
      });
      if (gama && !principalGamaPerTurno.has(tk)) principalGamaPerTurno.set(tk, gama);
    } else if (linha.tipo_benchmark === 'charriot' && e.linha === 'Linha charriot [B]') {
      if (!p) { result.set(i, { gama: null, tons: 0, reason: 'Produto não encontrado' }); continue; }
      const gama = lookupCharriotGama(p.comprimento, 'charriot_barrotes');
      result.set(i, {
        gama: gama?.nome || null, tons: Number(e.m3) * ratio,
        reason: gama ? null : 'Sem gama barrotes'
      });
      if (gama && !charriotBGamaPerTurno.has(tk)) charriotBGamaPerTurno.set(tk, gama);
    }
  }

  // Pass 2: aproveitamentos (inherit) + charriot duplos/tábuas + PSY/Sobras
  for (let i = 0; i < entries.length; i++) {
    if (result.has(i)) continue;
    const e = entries[i];
    const linha = linhaByNome[e.linha];
    if (!linha) { result.set(i, { gama: null, tons: 0, reason: 'Linha desconhecida' }); continue; }
    const tk = turnoKey(e);

    if (linha.sinal === '-') {
      result.set(i, { gama: null, tons: 0, reason: 'Retestagem (sem consumo rolaria)' });
    } else if (linha.tipo_benchmark === 'aproveitamentos') {
      if (isBLine(linha.nome)) {
        let gama = null, reason = '';
        if (e.turno === 'T2') {
          gama = weeklyFallbackGama;
          reason = gama ? 'Fallback semanal (principal + consumida)' : 'Sem principal na semana';
        } else {
          gama = principalGamaPerTurno.get(tk) || weeklyFallbackGama;
          reason = principalGamaPerTurno.get(tk) ? 'Herdado da principal (mesmo turno)'
                 : (gama ? 'Fallback semanal (principal sem trabalho no turno)' : 'Sem principal na semana');
        }
        result.set(i, { gama: gama?.nome || null, tons: Number(e.m3) * ratio, reason });
      } else {
        const gama = principalGamaPerTurno.get(tk) || null;
        result.set(i, {
          gama: gama?.nome || null, tons: Number(e.m3) * ratio,
          reason: gama ? 'Herdado da principal' : 'Sem principal no turno'
        });
      }
    } else if (linha.tipo_benchmark === 'charriot') {
      const gama = charriotBGamaPerTurno.get(tk) || null;
      result.set(i, {
        gama: gama?.nome || null, tons: Number(e.m3) * ratio,
        reason: gama ? 'Herdado do charriot [B]' : 'Sem [B] no turno'
      });
    } else {
      result.set(i, { gama: null, tons: Number(e.m3) * ratio, reason: 'Tipo desconhecido' });
    }
  }

  return result;
}

// Helper: calcula gama de fallback semanal = produto mais consumido (m³)
// na principal regular na semana.
export function computeWeeklyFallbackGama(entriesNaSemana, opts) {
  const { gamas, matriz, linhas, mp } = opts;
  const linhaByNome = Object.fromEntries(linhas.map(l => [l.nome, l]));
  const gamaById = Object.fromEntries(gamas.map(g => [g.id, g]));
  const mpMap = {};
  for (const p of mp) mpMap[p.produto_stock] = p;

  const isBLine = (nome) => / \(B\)$/.test(nome);
  const byProd = new Map();
  for (const e of entriesNaSemana) {
    const linha = linhaByNome[e.linha];
    if (!linha || linha.tipo_benchmark !== 'principal' || isBLine(linha.nome)) continue;
    if (!e.produto_stock) continue;
    byProd.set(e.produto_stock, (byProd.get(e.produto_stock) || 0) + Number(e.m3 || 0));
  }
  if (byProd.size === 0) return null;
  const topProd = [...byProd.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const p = mpMap[topProd];
  if (!p) return null;

  for (const row of matriz) {
    if (row.comp_produto_mm !== p.comprimento) continue;
    if (p.largura < row.larg_min || p.largura > row.larg_max) continue;
    if (p.espessura > row.esp_max) continue;
    if (row.costaneiro_esp_min != null && row.costaneiro_esp_max != null) continue;
    return gamaById[row.gama_id] || null;
  }
  return null;
}
