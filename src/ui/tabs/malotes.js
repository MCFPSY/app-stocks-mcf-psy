// Registos Produção MCF — grelha "turno-style"
// - No início do turno: empilhadorista escolhe produto + peças/malote por linha
// - Durante o turno: incrementa/decrementa malotes com botões grandes [−] (X) [+]
// - Auto-save a cada interação (localStorage) — nunca se perde nada
// - Submeter = envia todos os registos >0 para a BD. Reset = limpa tudo.

import { supabase } from '../../supabase.js';
import { toast } from '../app.js';
import { addMovimento, cachePut, cacheGet } from '../../offline.js';

// =========================================================
// Caches
// =========================================================
let mpCache = null;
let linhasCache = null;
let alturasCache = null;  // { cross_section -> altura_menor_mm }

async function loadMP() {
  if (mpCache) return mpCache;
  if (navigator.onLine) {
    const { data, error } = await supabase.from('mp_standard').select('*').eq('ativo', true).order('comprimento').order('largura').order('espessura');
    if (!error && data) { mpCache = data; await cachePut('mp_standard', data); return data; }
  }
  const cached = await cacheGet('mp_standard');
  if (cached) { mpCache = cached; return cached; }
  toast('Sem produtos em cache — liga à internet uma vez','error');
  return [];
}

async function loadLinhasMCF() {
  if (linhasCache) return linhasCache;
  if (navigator.onLine) {
    const { data } = await supabase.from('mcf_linhas').select('*').eq('ativo', true).order('ordem');
    if (data) { linhasCache = data; await cachePut('mcf_linhas', data); return data; }
  }
  const cached = await cacheGet('mcf_linhas');
  linhasCache = cached || [];
  return linhasCache;
}

async function loadAlturasMenores() {
  if (alturasCache) return alturasCache;
  if (navigator.onLine) {
    const { data } = await supabase.from('v_altura_menor').select('*');
    if (data) {
      const map = {};
      for (const r of data) map[r.cross_section] = r.altura_menor_mm;
      alturasCache = map;
      await cachePut('v_altura_menor', map);
      return map;
    }
  }
  const cached = await cacheGet('v_altura_menor');
  alturasCache = cached || {};
  return alturasCache;
}

// =========================================================
// Estado (persistido em localStorage por utilizador)
// =========================================================
function storageKey(userId) {
  return `mcfpsy-mcf-turno-${userId}`;
}

function loadState(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveState(userId, state) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch (e) { console.warn('saveState error', e); }
}

function clearState(userId) {
  localStorage.removeItem(storageKey(userId));
}

// =========================================================
// Render
// =========================================================
export async function renderMalotes(el, ctx) {
  el.innerHTML = `<div class="card"><h2>📦 Registos Produção MCF</h2><p class="sub">A carregar setup do turno...</p></div>`;
  const [mp, linhas, alturasMenores] = await Promise.all([loadMP(), loadLinhasMCF(), loadAlturasMenores()]);

  // Filtra linhas ativas com categoria definida (as outras aparecem mas sem filtro de produto)
  const linhasOrdenadas = linhas;

  // Estado inicial (do localStorage ou default)
  const userId = ctx.profile.id;
  const hoje = new Date().toISOString().slice(0, 10);
  let state = loadState(userId);
  if (!state || state.data_registo !== hoje) {
    // Reset automático quando muda o dia
    state = {
      data_registo: hoje,
      turno: state?.turno || 'T1',
      linhas: {},
    };
    // Pré-popular linhas com defaults
    for (const l of linhasOrdenadas) {
      const base = { produto_stock: '', pecas_por_malote: 0, malotes: 0 };
      if (l.sinal === '-') { base.produto_origem = ''; base.multiplicador = 1; }
      state.linhas[l.nome] = base;
    }
    saveState(userId, state);
  }

  // Garantir que todas as linhas existem no state (caso tenham sido adicionadas depois)
  for (const l of linhasOrdenadas) {
    if (!state.linhas[l.nome]) {
      const base = { produto_stock: '', pecas_por_malote: 0, malotes: 0 };
      if (l.sinal === '-') { base.produto_origem = ''; base.multiplicador = 1; }
      state.linhas[l.nome] = base;
    }
    // Migrar state antigo que não tinha estes campos
    if (l.sinal === '-' && state.linhas[l.nome].produto_origem === undefined) {
      state.linhas[l.nome].produto_origem = '';
      state.linhas[l.nome].multiplicador = 1;
    }
  }

  // Helper: produtos disponíveis para a linha (por categoria)
  function produtosDaLinha(linha) {
    // Linhas sinal='-' (PSY, Aprov-Sobras): mostram tábuas + tábuas charriot
    if (linha.sinal === '-') {
      return mp.filter(p => p.categoria === 'tabuas' || p.categoria === 'tabuas_charriot');
    }
    if (!linha.categoria) return mp;
    return mp.filter(p => p.categoria === linha.categoria);
  }

  // Helper: encontra produto por produto_stock
  function findMp(produto_stock) {
    return mp.find(p => p.produto_stock === produto_stock);
  }

  // Helper: m³ calculado para uma linha
  function calcM3(linhaState) {
    const p = findMp(linhaState.produto_stock);
    if (!p) return 0;
    const tot = (linhaState.malotes || 0) * (linhaState.pecas_por_malote || 0);
    const vol1 = (p.comprimento / 1000) * (p.largura / 1000) * (p.espessura / 1000);
    return +(vol1 * tot).toFixed(4);
  }

  // =========================================================
  // Sobra helpers (para linhas sinal='-')
  // =========================================================
  // Parses "CxLxE" into { comp, larg, esp } (mm)
  function parseSKU(sku) {
    if (!sku) return null;
    const parts = sku.split('x').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return { comp: parts[0], larg: parts[1], esp: parts[2] };
  }

  // Calcula sobra de retestagem e diz se é reaproveitável
  function calcSobra(produto_stock, produto_origem, multiplicador) {
    const pFinal = parseSKU(produto_stock);
    const pOrigem = parseSKU(produto_origem);
    if (!pFinal || !pOrigem || !multiplicador || multiplicador < 1) return null;
    const sobraComp = pOrigem.comp - (multiplicador * pFinal.comp);
    if (sobraComp <= 0) return { sobraComp: 0, reaproveitavel: false, sku: null };
    const cs = `${pOrigem.larg}x${pOrigem.esp}`;
    const altMin = alturasMenores[cs];
    const reaproveitavel = altMin != null && sobraComp >= altMin;
    const sobraCompArredondado = Math.floor(sobraComp / 100) * 100;
    const sobraSKU = sobraCompArredondado > 0 ? `${sobraCompArredondado}x${pOrigem.larg}x${pOrigem.esp}` : null;
    return { sobraComp, reaproveitavel, sku: reaproveitavel ? sobraSKU : null, altMin };
  }

  // =========================================================
  // Build HTML
  // =========================================================
  function rowHTML(linha) {
    const lineState = state.linhas[linha.nome];
    const produtos = produtosDaLinha(linha);
    const prodSuggest = findMp(lineState.produto_stock);
    const defaultPecas = prodSuggest ? prodSuggest.pecas_por_malote : 0;
    const malotes = lineState.malotes || 0;
    const m3v = calcM3(lineState);
    const totPecas = malotes * (lineState.pecas_por_malote || 0);
    const isMinus = linha.sinal === '-';

    let html = `
      <tr data-linha="${linha.nome}">
        <td style="padding:10px;font-weight:600;white-space:nowrap">${linha.nome}</td>
        <td style="padding:8px">
          <select class="field-prod" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem">
            <option value="">— Escolher produto —</option>
            ${produtos.map(p => `<option value="${p.produto_stock}" ${p.produto_stock === lineState.produto_stock ? 'selected' : ''}>${p.produto_conversao && p.produto_conversao !== p.produto_stock ? `${p.produto_conversao} → ${p.produto_stock}` : p.produto_stock}</option>`).join('')}
          </select>
        </td>
        <td style="padding:8px;width:100px">
          <input type="number" class="field-pecas" min="0" step="1" value="${lineState.pecas_por_malote || ''}" placeholder="${defaultPecas || '-'}" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.95rem;text-align:center;font-weight:600">
        </td>
        <td style="padding:8px">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px">
            <button type="button" class="btn-dec" style="width:44px;height:44px;border:2px solid var(--color-blue);background:#fff;color:var(--color-blue);border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">−</button>
            <input type="number" class="field-mal" min="0" step="0.5" value="${malotes}" style="width:80px;padding:10px;border:2px solid var(--color-border);border-radius:10px;text-align:center;font-size:1.2rem;font-weight:700">
            <button type="button" class="btn-inc" style="width:44px;height:44px;border:2px solid var(--color-blue);background:var(--color-blue);color:#fff;border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">+</button>
          </div>
        </td>
        <td style="padding:8px;text-align:center;font-weight:600;color:#1d1d1f" class="cell-totpecas">${totPecas || '-'}</td>
        <td style="padding:8px;text-align:center;font-weight:600;color:#495057" class="cell-m3">${m3v ? m3v.toFixed(3) + ' m³' : '-'}</td>
      </tr>
    `;

    // Sub-row: produto origem + multiplicador + sobra preview (só linhas sinal='-')
    if (isMinus) {
      const origemVal = lineState.produto_origem || '';
      const multVal = lineState.multiplicador || 1;
      const sobra = calcSobra(lineState.produto_stock, origemVal, multVal);
      let sobraLabel = '—';
      if (sobra) {
        if (sobra.sobraComp <= 0) sobraLabel = 'Sem sobra';
        else if (sobra.reaproveitavel) sobraLabel = `<span style="color:#1f7a3a;font-weight:600">${sobra.sku}</span> (reaprov.)`;
        else sobraLabel = `<span style="color:#c0392b;font-weight:600">${sobra.sobraComp}mm</span> &rarr; estilha`;
      }
      html += `
        <tr data-linha-extra="${linha.nome}" style="background:#fef9f0;border-top:none">
          <td></td>
          <td colspan="5" style="padding:4px 8px 10px">
            <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:1;min-width:180px">
                <label style="font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px">Produto origem</label>
                <input type="text" class="field-origem" value="${origemVal}" placeholder="ex: 2500x90x14"
                  list="mp-list"
                  style="width:100%;padding:7px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:.88rem">
              </div>
              <div style="width:90px">
                <label style="font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px">Multiplicador</label>
                <input type="number" class="field-mult" min="1" step="1" value="${multVal}"
                  style="width:100%;padding:7px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:.95rem;text-align:center;font-weight:600">
              </div>
              <div style="flex:1;min-width:140px;padding-bottom:4px" class="sobra-label">
                <span style="font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px">Sobra: </span>
                <span class="sobra-val" style="font-size:.88rem">${sobraLabel}</span>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
    return html;
  }

  el.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">📦 Registos Produção MCF</h2>
        <div style="display:flex;gap:12px;align-items:center">
          <span class="sync-pill" id="autoSaveInd" style="padding:4px 10px;background:#eef7ee;color:#1f7a3a;border-radius:999px;font-size:.75rem;font-weight:600">✓ Guardado</span>
        </div>
      </div>
      <p class="sub">Setup do turno: escolhe produto e peças/malote por linha (uma vez no início). Usa os botões <b>+</b> e <b>−</b> para somar malotes durante o turno. Tudo é guardado automaticamente no teu dispositivo — nada se perde até submeteres ou fazeres reset.</p>

      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="field" style="min-width:160px">
          <label>Data</label>
          <input type="date" id="dataReg" value="${state.data_registo}" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
        </div>
        <div class="field" style="min-width:120px">
          <label>Turno</label>
          <select id="turnoSel" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
            <option value="T1" ${state.turno==='T1'?'selected':''}>T1</option>
            <option value="T2" ${state.turno==='T2'?'selected':''}>T2</option>
            <option value="T3" ${state.turno==='T3'?'selected':''}>T3</option>
          </select>
        </div>
      </div>

      <div style="overflow-x:auto">
        <table id="grelha" style="width:100%;border-collapse:collapse;min-width:900px;font-size:.9rem">
          <thead>
            <tr style="background:#f5f5f7">
              <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Linha</th>
              <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Produto</th>
              <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Peças/malote</th>
              <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Nº malotes</th>
              <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Total peças</th>
              <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">m³</th>
            </tr>
          </thead>
          <tbody id="grelhaBody">
            ${linhasOrdenadas.map(rowHTML).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#f0f7ff;font-weight:700">
              <td colspan="3" style="padding:12px;border-top:2px solid var(--color-blue)">Total do turno</td>
              <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="totMalotes">0</td>
              <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="totPecas">0</td>
              <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="totM3">0 m³</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="mp-list">
        ${mp.map(p => `<option value="${p.produto_stock}">`).join('')}
      </datalist>

      <div class="btn-row" style="margin-top:20px">
        <button type="button" class="btn btn-danger btn-big" id="resetBtn">🗑 Reset</button>
        <button type="button" class="btn btn-success btn-big" id="submitBtn">✓ Submeter turno</button>
      </div>
    </div>
  `;

  // =========================================================
  // Interactions
  // =========================================================
  const body = el.querySelector('#grelhaBody');
  const saveInd = el.querySelector('#autoSaveInd');

  function flashSave() {
    saveInd.textContent = '💾 A gravar...';
    saveInd.style.background = '#e3f2fd';
    saveInd.style.color = '#0d47a1';
    setTimeout(() => {
      saveInd.textContent = '✓ Guardado';
      saveInd.style.background = '#eef7ee';
      saveInd.style.color = '#1f7a3a';
    }, 400);
  }

  function persist() {
    saveState(userId, state);
    flashSave();
  }

  function updateRowDerived(linhaNome) {
    const row = body.querySelector(`tr[data-linha="${CSS.escape(linhaNome)}"]`);
    if (!row) return;
    const ls = state.linhas[linhaNome];
    const totPecas = (ls.malotes || 0) * (ls.pecas_por_malote || 0);
    row.querySelector('.cell-totpecas').textContent = totPecas || '-';
    const m3v = calcM3(ls);
    row.querySelector('.cell-m3').textContent = m3v ? m3v.toFixed(3) + ' m³' : '-';
    updateTotals();
    updateSobraPreview(linhaNome);
  }

  function updateSobraPreview(linhaNome) {
    const extraRow = body.querySelector(`tr[data-linha-extra="${CSS.escape(linhaNome)}"]`);
    if (!extraRow) return;
    const ls = state.linhas[linhaNome];
    const sobra = calcSobra(ls.produto_stock, ls.produto_origem, ls.multiplicador);
    const valEl = extraRow.querySelector('.sobra-val');
    if (!valEl) return;
    if (!sobra || (!ls.produto_stock && !ls.produto_origem)) {
      valEl.innerHTML = '—';
    } else if (sobra.sobraComp <= 0) {
      valEl.innerHTML = 'Sem sobra';
    } else if (sobra.reaproveitavel) {
      valEl.innerHTML = `<span style="color:#1f7a3a;font-weight:600">${sobra.sku}</span> (reaprov.)`;
    } else {
      valEl.innerHTML = `<span style="color:#c0392b;font-weight:600">${sobra.sobraComp}mm</span> &rarr; estilha`;
    }
  }

  function updateTotals() {
    const tm = Object.values(state.linhas).reduce((s, l) => s + (Number(l.malotes) || 0), 0);
    const tp = Object.values(state.linhas).reduce((s, l) => s + (Number(l.malotes) || 0) * (Number(l.pecas_por_malote) || 0), 0);
    const tm3 = Object.values(state.linhas).reduce((s, l) => s + calcM3(l), 0);
    el.querySelector('#totMalotes').textContent = tm.toFixed(1);
    el.querySelector('#totPecas').textContent = tp.toFixed(0);
    el.querySelector('#totM3').textContent = tm3.toFixed(3) + ' m³';
  }

  // Change handlers per row
  body.querySelectorAll('tr[data-linha]').forEach(row => {
    const linhaNome = row.dataset.linha;
    const ls = state.linhas[linhaNome];

    const prodSel = row.querySelector('.field-prod');
    const pecasInp = row.querySelector('.field-pecas');
    const malInp = row.querySelector('.field-mal');
    const btnDec = row.querySelector('.btn-dec');
    const btnInc = row.querySelector('.btn-inc');

    // Produto change
    prodSel.addEventListener('change', () => {
      ls.produto_stock = prodSel.value;
      const p = findMp(ls.produto_stock);
      if (p && (!ls.pecas_por_malote || ls.pecas_por_malote === 0)) {
        ls.pecas_por_malote = p.pecas_por_malote;
        pecasInp.value = p.pecas_por_malote;
        pecasInp.placeholder = p.pecas_por_malote;
      } else if (p) {
        pecasInp.placeholder = p.pecas_por_malote;
      }
      persist();
      updateRowDerived(linhaNome);
    });

    // Peças/malote change
    pecasInp.addEventListener('change', () => {
      ls.pecas_por_malote = parseInt(pecasInp.value) || 0;
      persist();
      updateRowDerived(linhaNome);
    });

    // Stepper +/-
    btnInc.addEventListener('click', () => {
      ls.malotes = (Number(ls.malotes) || 0) + 1;
      malInp.value = ls.malotes;
      persist();
      updateRowDerived(linhaNome);
    });
    btnDec.addEventListener('click', () => {
      ls.malotes = Math.max(0, (Number(ls.malotes) || 0) - 1);
      malInp.value = ls.malotes;
      persist();
      updateRowDerived(linhaNome);
    });

    // Direct input
    malInp.addEventListener('change', () => {
      ls.malotes = Math.max(0, parseFloat(malInp.value) || 0);
      malInp.value = ls.malotes;
      persist();
      updateRowDerived(linhaNome);
    });
  });

  // Event listeners para sub-rows sinal='-' (produto_origem + multiplicador)
  body.querySelectorAll('tr[data-linha-extra]').forEach(extraRow => {
    const linhaNome = extraRow.dataset.linhaExtra;
    const ls = state.linhas[linhaNome];
    const origemInp = extraRow.querySelector('.field-origem');
    const multInp = extraRow.querySelector('.field-mult');

    origemInp.addEventListener('change', () => {
      ls.produto_origem = origemInp.value.trim();
      persist();
      updateSobraPreview(linhaNome);
    });
    multInp.addEventListener('change', () => {
      ls.multiplicador = Math.max(1, parseInt(multInp.value) || 1);
      multInp.value = ls.multiplicador;
      persist();
      updateSobraPreview(linhaNome);
    });
  });

  // Date / turno
  el.querySelector('#dataReg').addEventListener('change', (e) => {
    state.data_registo = e.target.value || hoje;
    persist();
  });
  el.querySelector('#turnoSel').addEventListener('change', (e) => {
    state.turno = e.target.value;
    persist();
  });

  // Reset
  el.querySelector('#resetBtn').addEventListener('click', () => {
    if (!confirm('Apagar setup e quantidades atuais? Esta ação não pode ser desfeita.')) return;
    clearState(userId);
    linhasCache = null; // force reload in case
    renderMalotes(el, ctx);
  });

  // Submit
  el.querySelector('#submitBtn').addEventListener('click', async () => {
    const entriesToSubmit = [];
    for (const [linhaNome, ls] of Object.entries(state.linhas)) {
      if (!ls.produto_stock) continue;
      const m = Number(ls.malotes) || 0;
      if (m <= 0) continue;
      const np = Number(ls.pecas_por_malote) || 0;
      if (np <= 0) {
        toast(`Peças/malote em falta na linha ${linhaNome}`, 'error');
        return;
      }
      const p = findMp(ls.produto_stock);
      if (!p) continue;
      const vol1 = (p.comprimento / 1000) * (p.largura / 1000) * (p.espessura / 1000);
      const m3v = +(vol1 * m * np).toFixed(4);
      const entry = {
        tipo: 'entrada_producao',
        empresa: 'MCF',
        produto_stock: p.produto_stock,
        malotes: m,
        pecas_por_malote: np,
        m3: m3v,
        operador_id: ctx.profile.id,
        incerteza: false,
        duvida_resolvida: true,
        data_registo: state.data_registo,
        linha: linhaNome,
        turno: state.turno,
      };
      // Linhas sinal='-': incluir produto_origem + multiplicador
      if (ls.produto_origem) entry.produto_origem = ls.produto_origem;
      if (ls.multiplicador && ls.multiplicador > 0) entry.multiplicador = ls.multiplicador;
      entriesToSubmit.push(entry);
    }

    if (entriesToSubmit.length === 0) {
      toast('Sem malotes para submeter. Adiciona pelo menos uma quantidade > 0.', 'error');
      return;
    }

    const ok = confirm(`Submeter ${entriesToSubmit.length} registo(s) — total ${entriesToSubmit.reduce((s,e)=>s+e.m3,0).toFixed(2)} m³?`);
    if (!ok) return;

    const btn = el.querySelector('#submitBtn');
    btn.disabled = true; btn.textContent = 'A submeter...';
    let offline = 0, online = 0;
    for (const entry of entriesToSubmit) {
      const res = await addMovimento(entry);
      if (res.offline) offline++; else online++;
    }
    btn.disabled = false; btn.textContent = '✓ Submeter turno';

    toast(
      offline > 0
        ? `✓ ${online} submetidos, ${offline} em fila offline`
        : `✓ ${online} registos submetidos`,
      'success'
    );

    // Clear malotes counters but keep setup (produto + peças/malote + origem/mult)
    for (const linhaNome of Object.keys(state.linhas)) {
      state.linhas[linhaNome].malotes = 0;
    }
    // Nota: produto_origem + multiplicador NÃO são limpos — mantêm-se para o próximo turno
    persist();
    renderMalotes(el, ctx);
    window.dispatchEvent(new CustomEvent('sync-done'));
  });

  updateTotals();
}
