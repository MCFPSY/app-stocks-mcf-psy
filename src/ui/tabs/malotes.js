// Registos Produção MCF — grelha "turno-style"
// - Linhas normais (sinal='+'): 1 produto por linha
// - Linhas sinal='-' (PSY, Aprov-Sobras): multi-produto (entries array, botão "+")
// - Sub-linhas madeira 2ª: indentadas visualmente sob principal/aproveitamentos
// - Auto-save a cada interação (localStorage)

import { supabase } from '../../supabase.js';
import { toast } from '../app.js';
import { addMovimento, cachePut, cacheGet } from '../../offline.js';
import { computeRolariaPerEntry, computeWeeklyFallbackGama } from '../../rolaria.js';

// =========================================================
// Caches
// =========================================================
let mpCache = null;
let linhasCache = null;
let alturasCache = null;
let compatCache = null;
let linhaProdutosCache = null;

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

async function loadLinhaProdutos() {
  if (linhaProdutosCache) return linhaProdutosCache;
  if (navigator.onLine) {
    const { data } = await supabase.from('linha_produtos').select('linha_nome, produto_stock').eq('ativo', true);
    if (data) {
      const map = {};
      for (const r of data) {
        if (!map[r.linha_nome]) map[r.linha_nome] = new Set();
        map[r.linha_nome].add(r.produto_stock);
      }
      linhaProdutosCache = map;
      const ser = {};
      for (const [k, v] of Object.entries(map)) ser[k] = [...v];
      await cachePut('linha_produtos', ser);
      return map;
    }
  }
  const cached = await cacheGet('linha_produtos');
  if (cached) {
    const map = {};
    for (const [k, v] of Object.entries(cached)) map[k] = new Set(v);
    linhaProdutosCache = map;
  } else {
    linhaProdutosCache = {};
  }
  return linhaProdutosCache;
}

async function loadCompat() {
  if (compatCache) return compatCache;
  if (navigator.onLine) {
    const { data } = await supabase.from('rolaria_sobras_compat').select('cross_section, output_larg, output_esp');
    if (data) {
      const map = {};
      for (const r of data) {
        if (!r.output_larg || !r.output_esp) continue;
        if (!map[r.cross_section]) map[r.cross_section] = new Set();
        map[r.cross_section].add(`${r.output_larg}|${r.output_esp}`);
      }
      const serialized = {};
      for (const [k, v] of Object.entries(map)) serialized[k] = [...v];
      compatCache = map;
      await cachePut('rolaria_compat', serialized);
      return map;
    }
  }
  const cached = await cacheGet('rolaria_compat');
  if (cached) {
    const map = {};
    for (const [k, v] of Object.entries(cached)) map[k] = new Set(v);
    compatCache = map;
  } else {
    compatCache = {};
  }
  return compatCache;
}

// =========================================================
// Estado (persistido em localStorage por utilizador)
// =========================================================
function storageKey(userId) { return `mcfpsy-mcf-turno-${userId}`; }
function loadState(userId) { try { const r = localStorage.getItem(storageKey(userId)); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveState(userId, state) { try { localStorage.setItem(storageKey(userId), JSON.stringify(state)); } catch (e) { console.warn('saveState', e); } }
function clearState(userId) { localStorage.removeItem(storageKey(userId)); }

// UI prefs: estado collapse/expand dos aproveitamentos (B)
const UI_PREFS_KEY = 'mcfpsy-mcf-uiprefs';
function loadUiPrefs() { try { return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}'); } catch { return {}; } }
function saveUiPrefs(p) { try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p)); } catch {} }

function emptyEntry() { return { produto_stock: '', pecas_por_malote: 0, malotes: 0, produto_origem: '', multiplicador: 1 }; }

// =========================================================
// Render
// =========================================================
export async function renderMalotes(el, ctx) {
  el.innerHTML = `<div class="card"><h2>📦 Registos Produção MCF</h2><p class="sub">A carregar...</p></div>`;
  const [mp, linhas, alturasMenores, compatMap, allowMap] = await Promise.all([loadMP(), loadLinhasMCF(), loadAlturasMenores(), loadCompat(), loadLinhaProdutos()]);
  const linhasOrdenadas = linhas;

  const userId = ctx.profile.id;
  const hoje = new Date().toISOString().slice(0, 10);
  let state = loadState(userId);

  // Reset diário
  if (!state || state.data_registo !== hoje) {
    state = { data_registo: hoje, linhas: {} };
    for (const l of linhasOrdenadas) {
      state.linhas[l.nome] = l.sinal === '-' ? { entries: [emptyEntry()] } : { produto_stock: '', pecas_por_malote: 0, malotes: 0 };
    }
    saveState(userId, state);
  }

  // Pré-fill a partir de movimentos do dia (turnos anteriores ou outro operador):
  // para cada linha vazia das famílias principal/aproveitamentos/charriot, busca
  // o último produto registado nessa data. Linhas PSY/Sobras NÃO são pré-preenchidas.
  // overwriteEmptyOnly=true → não sobrescreve produtos já escolhidos.
  async function prefillFromDay(date, overwriteEmptyOnly = true) {
    if (!navigator.onLine) return 0;
    try {
      const { data: dayMovs, error } = await supabase.from('movimentos')
        .select('linha, produto_stock, pecas_por_malote, criado_em')
        .eq('tipo', 'entrada_producao').eq('empresa', 'MCF')
        .eq('estornado', false).eq('data_registo', date)
        .not('linha', 'is', null)
        .order('criado_em', { ascending: false });
      if (error) { console.warn('[prefill] erro supabase:', error); return 0; }
      console.log(`[prefill] ${dayMovs?.length || 0} movimentos para ${date}`);
      if (!dayMovs?.length) return 0;
      const lastByLinha = {};
      for (const m of dayMovs) {
        if (!lastByLinha[m.linha]) lastByLinha[m.linha] = m;
      }
      let count = 0;
      for (const l of linhasOrdenadas) {
        if (l.sinal === '-') continue; // PSY/Sobras: não pré-preencher
        const ls = state.linhas[l.nome];
        if (overwriteEmptyOnly && ls.produto_stock) continue;
        const last = lastByLinha[l.nome];
        if (last) {
          ls.produto_stock = last.produto_stock;
          ls.pecas_por_malote = last.pecas_por_malote || 0;
          count++;
        }
      }
      if (count) saveState(userId, state);
      return count;
    } catch (err) {
      console.warn('[prefill] exceção:', err);
      return 0;
    }
  }
  await prefillFromDay(state.data_registo, true);

  // Helper: deriva turno do nome da linha (T1/T2/T3 inerente) ou null
  function deriveTurno(nome) {
    const m = nome?.match(/\b(T[123])\b/);
    return m ? m[1] : null;
  }

  // Garantir + migrar
  for (const l of linhasOrdenadas) {
    if (!state.linhas[l.nome]) {
      state.linhas[l.nome] = l.sinal === '-' ? { entries: [emptyEntry()] } : { produto_stock: '', pecas_por_malote: 0, malotes: 0 };
    }
    // Migrar formato flat antigo → entries
    if (l.sinal === '-' && !state.linhas[l.nome].entries) {
      const o = state.linhas[l.nome];
      state.linhas[l.nome] = { entries: [{ produto_stock: o.produto_stock || '', pecas_por_malote: o.pecas_por_malote || 0, malotes: o.malotes || 0, produto_origem: o.produto_origem || '', multiplicador: o.multiplicador || 1 }] };
    }
  }

  // =========================================================
  // Helpers
  // =========================================================
  const linhaByNome = Object.fromEntries(linhasOrdenadas.map(l => [l.nome, l]));

  function findMp(sku) { return mp.find(p => p.produto_stock === sku); }

  function produtosDaLinha(linha) {
    // 1ª prioridade: allow-list explícita (linha_produtos) — só mostra produtos
    // historicamente feitos nesta linha.
    const allow = allowMap[linha.nome];
    if (allow && allow.size > 0) return mp.filter(p => allow.has(p.produto_stock));
    // Fallback: filtro por categoria (compat com linhas sem allow-list)
    if (linha.sinal === '-') return mp.filter(p => p.categoria === 'tabuas' || p.categoria === 'tabuas_charriot');
    if (!linha.categoria) return mp;
    return mp.filter(p => p.categoria === linha.categoria);
  }

  function calcM3Entry(e) {
    const p = findMp(e.produto_stock);
    if (!p) return 0;
    return +((p.comprimento / 1000) * (p.largura / 1000) * (p.espessura / 1000) * (e.malotes || 0) * (e.pecas_por_malote || 0)).toFixed(4);
  }

  function parseSKU(sku) {
    if (!sku) return null;
    const parts = sku.split('x').map(Number);
    return parts.length === 3 && parts.every(n => !isNaN(n)) ? { comp: parts[0], larg: parts[1], esp: parts[2] } : null;
  }

  function calcSobra(produto_stock, produto_origem, multiplicador) {
    const pOut = parseSKU(produto_stock), pSrc = parseSKU(produto_origem);
    if (!pOut || !pSrc || !multiplicador || multiplicador < 1) return null;
    const sobraComp = pSrc.comp - (multiplicador * pOut.comp);
    if (sobraComp <= 0) return { sobraComp: 0, reaproveitavel: false, sku: null };
    const cs = `${pSrc.larg}x${pSrc.esp}`;
    const altMin = alturasMenores[cs];
    const ok = altMin != null && sobraComp >= altMin;
    const rounded = Math.floor(sobraComp / 100) * 100;
    const sku = rounded > 0 ? `${rounded}x${pSrc.larg}x${pSrc.esp}` : null;
    return { sobraComp, reaproveitavel: ok, sku: ok ? sku : null, altMin };
  }

  // Compat maps
  const minusPool = mp.filter(p => p.categoria === 'tabuas' || p.categoria === 'tabuas_charriot');
  const fwdCompat = compatMap;
  const revCompat = {};
  for (const [srcCS, outputs] of Object.entries(fwdCompat)) {
    for (const outLE of outputs) {
      if (!revCompat[outLE]) revCompat[outLE] = new Set();
      revCompat[outLE].add(srcCS);
    }
  }

  function origemOptionsHTML(produtoStock, selected) {
    const pOut = findMp(produtoStock);
    return minusPool.filter(p => {
      if (pOut && p.comprimento <= pOut.comprimento) return false;
      if (!pOut) return true;
      const outKey = `${pOut.largura}|${pOut.espessura}`;
      const valid = revCompat[outKey];
      if (valid) return valid.has(`${p.largura}x${p.espessura}`);
      return p.largura === pOut.largura && p.espessura >= pOut.espessura;
    }).map(p => `<option value="${p.produto_stock}" ${p.produto_stock === selected ? 'selected' : ''}>${p.produto_stock}</option>`).join('');
  }

  function produtoOptionsForMinus(origemStock, selected, linhaNome) {
    const pSrc = findMp(origemStock);
    const allow = linhaNome ? allowMap[linhaNome] : null;
    // Pool de partida: allow-list da linha (se existir), senão o pool genérico
    const pool = (allow && allow.size > 0)
      ? mp.filter(p => allow.has(p.produto_stock))
      : minusPool;
    return pool.filter(p => {
      if (pSrc && p.comprimento >= pSrc.comprimento) return false;
      if (!pSrc) return true;
      const srcKey = `${pSrc.largura}x${pSrc.espessura}`;
      const valid = fwdCompat[srcKey];
      if (valid) return valid.has(`${p.largura}|${p.espessura}`);
      return p.largura === pSrc.largura && p.espessura <= pSrc.espessura;
    }).map(p => `<option value="${p.produto_stock}" ${p.produto_stock === selected ? 'selected' : ''}>${p.produto_stock}</option>`).join('');
  }

  // =========================================================
  // Build HTML helpers
  // =========================================================
  const isSubLine = (nome) => nome.startsWith('[+] Madeira de 2ª');
  const subLineLabel = (nome) => nome.replace('[+] ', '').replace('Aprov ', 'Aprov. ');

  function normalRowHTML(linha) {
    const ls = state.linhas[linha.nome];
    let produtos = produtosDaLinha(linha);
    // Garante que o produto selecionado aparece na lista (mesmo se não estiver
    // na allow-list — caso típico de produto pré-preenchido vindo da BD ou
    // de auto-sync entre linhas com allow-lists diferentes).
    if (ls.produto_stock && !produtos.some(p => p.produto_stock === ls.produto_stock)) {
      const found = findMp(ls.produto_stock);
      produtos = [...produtos, found || { produto_stock: ls.produto_stock, produto_conversao: null }];
    }
    const suggest = findMp(ls.produto_stock);
    const defPecas = suggest ? suggest.pecas_por_malote : 0;
    const malotes = ls.malotes || 0;
    const m3v = calcM3Entry(ls);
    const totPecas = malotes * (ls.pecas_por_malote || 0);
    const isSub = isSubLine(linha.nome);
    const nameStyle = isSub ? 'padding:4px 8px 10px 30px;font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px;vertical-align:top' : 'padding:10px;font-weight:600;white-space:nowrap';
    const hasDuvida = ls.duvida === true;
    const rowStyle = hasDuvida ? 'background:#fff3cd' : (isSub ? 'background:#fef9f0' : '');
    const displayName = isSub ? subLineLabel(linha.nome) : linha.nome;

    return `
      <tr data-linha="${linha.nome}" style="${rowStyle}">
        <td style="${nameStyle}">
          ${displayName}
          <button type="button" class="btn-duvida" title="Marcar dúvida" style="margin-left:6px;background:none;border:1px solid ${hasDuvida ? '#c0392b' : '#ddd'};color:${hasDuvida ? '#c0392b' : '#999'};border-radius:6px;font-size:.7rem;padding:2px 6px;cursor:pointer;vertical-align:middle">❓${hasDuvida ? ' Dúvida' : ''}</button>
        </td>
        <td style="padding:8px">
          <select class="field-prod" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem">
            <option value="">— Escolher produto —</option>
            ${produtos.map(p => `<option value="${p.produto_stock}" ${p.produto_stock === ls.produto_stock ? 'selected' : ''}>${p.produto_conversao && p.produto_conversao !== p.produto_stock ? `${p.produto_conversao} → ${p.produto_stock}` : p.produto_stock}</option>`).join('')}
          </select>
        </td>
        <td style="padding:8px;width:100px">
          <input type="number" class="field-pecas" min="0" step="1" value="${ls.pecas_por_malote || ''}" placeholder="${defPecas || '-'}" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.95rem;text-align:center;font-weight:600">
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
      </tr>`;
  }

  function minusRowHTML(linha) {
    const ls = state.linhas[linha.nome];
    const entries = ls.entries || [emptyEntry()];
    let html = '';

    for (let idx = 0; idx < entries.length; idx++) {
      const e = entries[idx];
      const suggest = findMp(e.produto_stock);
      const defPecas = suggest ? suggest.pecas_por_malote : 0;
      const malotes = e.malotes || 0;
      const m3v = calcM3Entry(e);
      const totPecas = malotes * (e.pecas_por_malote || 0);
      const sobra = calcSobra(e.produto_stock, e.produto_origem, e.multiplicador);
      let sobraLabel = '—';
      if (sobra) {
        if (sobra.sobraComp <= 0) sobraLabel = 'Sem sobra';
        else if (sobra.reaproveitavel) sobraLabel = `<span style="color:#1f7a3a;font-weight:600">${sobra.sku}</span> (reaprov.)`;
        else sobraLabel = `<span style="color:#c0392b;font-weight:600">${sobra.sobraComp}mm</span> &rarr; estilha`;
      }

      // Product row
      const hasDuvida = e.duvida === true;
      const nameCell = idx === 0
        ? `<td style="padding:10px;font-weight:600;white-space:nowrap;vertical-align:top">${linha.nome}</td>`
        : `<td style="padding:10px"></td>`;
      const rowBorder = idx > 0 ? 'border-top:1px dashed #ddd' : '';
      const rowBg = hasDuvida ? 'background:#fff3cd;' : '';
      html += `
        <tr data-minus-linha="${linha.nome}" data-eidx="${idx}" style="${rowBg}${rowBorder}">
          ${nameCell}
          <td style="padding:8px">
            <select class="field-prod-m" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem">
              <option value="">— Escolher produto —</option>
              ${produtoOptionsForMinus(e.produto_origem, e.produto_stock, linha.nome)}
            </select>
            <button type="button" class="btn-duvida-m" title="Marcar dúvida" style="margin-top:4px;background:none;border:1px solid ${hasDuvida ? '#c0392b' : '#ddd'};color:${hasDuvida ? '#c0392b' : '#999'};border-radius:6px;font-size:.7rem;padding:2px 6px;cursor:pointer">❓${hasDuvida ? ' Dúvida' : ' marcar dúvida'}</button>
          </td>
          <td style="padding:8px;width:100px">
            <input type="number" class="field-pecas-m" min="0" step="1" value="${e.pecas_por_malote || ''}" placeholder="${defPecas || '-'}" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.95rem;text-align:center;font-weight:600">
          </td>
          <td style="padding:8px">
            <div style="display:flex;align-items:center;justify-content:center;gap:6px">
              <button type="button" class="btn-dec-m" style="width:44px;height:44px;border:2px solid var(--color-blue);background:#fff;color:var(--color-blue);border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">−</button>
              <input type="number" class="field-mal-m" min="0" step="0.5" value="${malotes}" style="width:80px;padding:10px;border:2px solid var(--color-border);border-radius:10px;text-align:center;font-size:1.2rem;font-weight:700">
              <button type="button" class="btn-inc-m" style="width:44px;height:44px;border:2px solid var(--color-blue);background:var(--color-blue);color:#fff;border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">+</button>
              ${entries.length > 1 ? `<button type="button" class="btn-remove-entry" data-eidx="${idx}" style="margin-left:2px;background:none;border:none;color:#c0392b;cursor:pointer;font-size:1.1rem;font-weight:700" title="Remover entrada">&times;</button>` : ''}
            </div>
          </td>
          <td style="padding:8px;text-align:center;font-weight:600;color:#1d1d1f">${totPecas || '-'}</td>
          <td style="padding:8px;text-align:center;font-weight:600;color:#495057">${m3v ? m3v.toFixed(3) + ' m³' : '-'}</td>
        </tr>`;

      // Origem sub-row
      html += `
        <tr data-minus-extra="${linha.nome}" data-eidx="${idx}" style="background:#fef9f0">
          <td></td>
          <td colspan="5" style="padding:4px 8px 10px">
            <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:1;min-width:180px">
                <label style="font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px">Produto origem</label>
                <select class="field-origem-m" style="width:100%;padding:7px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:.88rem">
                  <option value="">— Escolher origem —</option>
                  ${origemOptionsHTML(e.produto_stock, e.produto_origem)}
                </select>
              </div>
              <div style="width:90px">
                <label style="font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px">Multiplicador</label>
                <input type="number" class="field-mult-m" min="1" step="1" value="${e.multiplicador || 1}" style="width:100%;padding:7px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:.95rem;text-align:center;font-weight:600">
              </div>
              <div style="flex:1;min-width:140px;padding-bottom:4px">
                <span style="font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px">Sobra: </span>
                <span style="font-size:.88rem">${sobraLabel}</span>
              </div>
            </div>
          </td>
        </tr>`;
    }

    // Add-entry button row
    html += `
      <tr data-minus-add="${linha.nome}" style="background:#fef9f0">
        <td></td>
        <td colspan="5" style="padding:6px 8px 10px">
          <button type="button" class="btn-add-entry" style="padding:6px 16px;background:#fff;border:2px dashed var(--color-blue);color:var(--color-blue);border-radius:8px;font-size:.85rem;cursor:pointer;font-weight:600">+ Adicionar produto</button>
        </td>
      </tr>`;

    return html;
  }

  // Grupos de linhas para separadores visuais + cabeçalhos coloridos
  function groupOf(nome) {
    if (nome.startsWith('Linha principal') || nome === '[+] Madeira de 2ª T1' || nome === '[+] Madeira de 2ª T3') return 'principal';
    if (nome.includes('charriot')) return 'charriot';
    if (nome.startsWith('Linha aproveitamentos') || nome.startsWith('[+] Madeira de 2ª Aprov')) return 'aproveitamentos';
    if (nome.startsWith('[-]')) return 'retestagem';
    return 'other';
  }

  const GROUP_META = {
    principal:       { label: 'Linhas Principais',   color: '#0d6efd' },
    charriot:        { label: 'Charriot',            color: '#6f42c1' },
    aproveitamentos: { label: 'Aproveitamentos',     color: '#198754' },
    retestagem:      { label: 'Retestagem',          color: '#dc3545' },
    other:           { label: 'Outros',              color: '#6c757d' },
  };

  function groupHeaderRow(group) {
    const meta = GROUP_META[group] || GROUP_META.other;
    return `<tr class="group-header grp-${group}"><td colspan="6" style="padding:18px 14px 8px 12px;background:transparent;border:none">
      <span style="display:inline-block;padding:3px 10px;background:${meta.color}15;color:${meta.color};border-left:4px solid ${meta.color};font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;border-radius:2px">${meta.label}</span>
    </td></tr>`;
  }

  function separatorRow() {
    return `<tr class="group-separator"><td colspan="6" style="padding:0;height:18px;background:transparent;border:none"></td></tr>`;
  }

  function rowHTML(linha) {
    return linha.sinal === '-' ? minusRowHTML(linha) : normalRowHTML(linha);
  }

  // =========================================================
  // Main HTML
  // =========================================================
  el.innerHTML = `
    <style>
      #grelha tbody tr[data-grp="principal"] > td:first-child { box-shadow:inset 4px 0 0 ${GROUP_META.principal.color} }
      #grelha tbody tr[data-grp="charriot"] > td:first-child { box-shadow:inset 4px 0 0 ${GROUP_META.charriot.color} }
      #grelha tbody tr[data-grp="aproveitamentos"] > td:first-child { box-shadow:inset 4px 0 0 ${GROUP_META.aproveitamentos.color} }
      #grelha tbody tr[data-grp="retestagem"] > td:first-child { box-shadow:inset 4px 0 0 ${GROUP_META.retestagem.color} }
      #grelha tbody tr.group-separator > td,
      #grelha tbody tr.group-header > td { box-shadow:none !important }
      /* Linha fina discreta entre blocos dentro do mesmo grupo */
      #grelha tbody tr[data-linha] > td { border-top:1px solid #f0f0f0 }
      #grelha tbody tr[data-minus-linha][data-eidx="0"] > td { border-top:1px solid #f0f0f0 }

      /* === Responsivo: tablet portrait / mobile ===
         Mantém TODAS as colunas visíveis, encolhe tudo para caber sem
         scroll horizontal. Em landscape/desktop volta ao tamanho normal. */
      @media (max-width: 900px) {
        #grelha { min-width: 0 !important; font-size: .75rem !important; table-layout: fixed; width: 100%; }
        /* Headers: padding mínimo + fonte pequena */
        #grelha th { padding: 6px 2px !important; font-size: .68rem !important; }
        #grelha td { padding: 4px 2px !important; }
        /* Larguras forçadas das colunas (% do total disponível) */
        #grelha thead th:nth-child(1) { width: 14%; }
        #grelha thead th:nth-child(2) { width: 30%; }
        #grelha thead th:nth-child(3) { width: 9%; }
        #grelha thead th:nth-child(4) { width: 27%; }
        #grelha thead th:nth-child(5) { width: 8%; }
        #grelha thead th:nth-child(6) { width: 12%; }
        /* Nome linha: quebra em múltiplas linhas, fonte menor */
        #grelha tbody td:first-child { white-space: normal !important; line-height: 1.15 !important; font-size: .72rem !important; word-break: break-word; }
        /* Selects e inputs: tudo encolhido */
        #grelha .field-prod, #grelha .field-prod-m,
        #grelha .field-pecas, #grelha .field-pecas-m,
        #grelha .field-origem-m, #grelha .field-mult-m {
          font-size: .75rem !important; padding: 5px 4px !important; width: 100% !important;
          box-sizing: border-box; min-width: 0;
        }
        /* Stepper compacto: botões 28×28, input 38px */
        #grelha .btn-inc, #grelha .btn-dec,
        #grelha .btn-inc-m, #grelha .btn-dec-m {
          width: 28px !important; height: 28px !important; font-size: 1rem !important;
          border-width: 1px !important; border-radius: 6px !important;
        }
        #grelha .field-mal, #grelha .field-mal-m {
          width: 38px !important; font-size: .85rem !important; padding: 4px 2px !important;
          border-width: 1px !important; border-radius: 6px !important;
        }
        /* Reduz gap dentro da célula do stepper */
        #grelha td > div[style*="display:flex"] { gap: 2px !important; }
        /* Botão remover (×) mais pequeno */
        #grelha .btn-remove-entry { font-size: .9rem !important; padding: 0 2px !important; }
        /* Total peças e m³: fonte menor, sem truncar */
        #grelha tbody td:nth-child(5),
        #grelha tbody td:nth-child(6) { font-size: .72rem !important; }
        /* Dúvida button mais compacto */
        #grelha .btn-duvida, #grelha .btn-duvida-m {
          font-size: .6rem !important; padding: 1px 4px !important; margin-left: 2px !important;
        }
      }
      /* Mobile mais apertado (smartphone portrait, ≤ 480px) */
      @media (max-width: 480px) {
        #grelha { font-size: .68rem !important; }
        #grelha .btn-inc, #grelha .btn-dec,
        #grelha .btn-inc-m, #grelha .btn-dec-m {
          width: 24px !important; height: 24px !important;
        }
        #grelha .field-mal, #grelha .field-mal-m { width: 32px !important; }
      }
    </style>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">📦 Registos Produção MCF</h2>
        <span class="sync-pill" id="autoSaveInd" style="padding:4px 10px;background:#eef7ee;color:#1f7a3a;border-radius:999px;font-size:.75rem;font-weight:600">✓ Guardado</span>
      </div>
      <p class="sub">Setup do turno: escolhe produto e peças/malote por linha. Usa <b>+</b> e <b>−</b> para malotes. Auto-save contínuo.</p>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="field" style="min-width:160px">
          <label>Data</label>
          <input type="date" id="dataReg" value="${state.data_registo}" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
        </div>
      </div>
      <div style="overflow-x:auto">
        <table id="grelha" style="width:100%;border-collapse:collapse;min-width:900px;font-size:.9rem">
          <thead><tr style="background:#f5f5f7">
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Linha</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Produto</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Peças/malote</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Nº malotes</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Total peças</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">m³</th>
          </tr></thead>
          <tbody id="grelhaBody">${(() => {
            const uiPrefs = loadUiPrefs();
            const bExpanded = !!uiPrefs.aprovBExpanded;
            const isB = (nome) => / \(B\)$/.test(nome);
            let out = '';
            let prevGroup = null;
            let aprovBBtnInserted = false;
            for (const l of linhasOrdenadas) {
              const g = groupOf(l.nome);
              const lineIsB = isB(l.nome);

              // Inserir botão de toggle antes das linhas (B) se ainda não inserido
              if (g === 'aproveitamentos' && lineIsB && !aprovBBtnInserted) {
                out += `<tr class="aprov-b-toggle"><td colspan="6" style="padding:6px 12px 10px;background:transparent">
                  <button type="button" id="aprovBToggle" data-expanded="${bExpanded ? '1' : '0'}"
                    style="padding:6px 14px;background:#fff;border:2px dashed ${GROUP_META.aproveitamentos.color};color:${GROUP_META.aproveitamentos.color};border-radius:8px;font-size:.8rem;cursor:pointer;font-weight:600">
                    ${bExpanded ? '− Ocultar aproveitamentos (B)' : '+ Aproveitamentos (B)'}
                  </button>
                </td></tr>`;
                aprovBBtnInserted = true;
              }

              // Saltar linhas (B) se minimizado
              if (lineIsB && !bExpanded) continue;

              if (g !== prevGroup) {
                if (prevGroup !== null) out += separatorRow();
                out += groupHeaderRow(g);
              }
              const tagged = rowHTML(l).replace(/<tr (data-linha|data-minus-linha|data-minus-extra|data-minus-add)=/g,
                `<tr data-grp="${g}" $1=`);
              out += tagged;
              prevGroup = g;
            }
            return out;
          })()}</tbody>
          <tfoot><tr style="background:#f0f7ff;font-weight:700">
            <td colspan="3" style="padding:12px;border-top:2px solid var(--color-blue)">Total do turno</td>
            <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="totMalotes">0</td>
            <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="totPecas">0</td>
            <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="totM3">0 m³</td>
          </tr></tfoot>
        </table>
      </div>
      <div class="btn-row" style="margin-top:20px">
        <button type="button" class="btn btn-danger btn-big" id="resetBtn">🗑 Reset</button>
        <button type="button" class="btn btn-success btn-big" id="submitBtn">✓ Submeter turno</button>
      </div>
    </div>`;

  // =========================================================
  // Interactions (event delegation)
  // =========================================================
  const body = el.querySelector('#grelhaBody');
  const saveInd = el.querySelector('#autoSaveInd');

  function flashSave() {
    saveInd.textContent = '💾 A gravar...'; saveInd.style.background = '#e3f2fd'; saveInd.style.color = '#0d47a1';
    setTimeout(() => { saveInd.textContent = '✓ Guardado'; saveInd.style.background = '#eef7ee'; saveInd.style.color = '#1f7a3a'; }, 400);
  }
  function persist() { saveState(userId, state); flashSave(); }

  function updateTotals() {
    let tm = 0, tp = 0, tm3 = 0;
    for (const l of linhasOrdenadas) {
      const ls = state.linhas[l.nome];
      if (l.sinal === '-') {
        for (const e of (ls.entries || [])) {
          tm += Number(e.malotes) || 0;
          tp += (Number(e.malotes) || 0) * (Number(e.pecas_por_malote) || 0);
          tm3 += calcM3Entry(e);
        }
      } else {
        tm += Number(ls.malotes) || 0;
        tp += (Number(ls.malotes) || 0) * (Number(ls.pecas_por_malote) || 0);
        tm3 += calcM3Entry(ls);
      }
    }
    el.querySelector('#totMalotes').textContent = tm.toFixed(1);
    el.querySelector('#totPecas').textContent = tp.toFixed(0);
    el.querySelector('#totM3').textContent = tm3.toFixed(3) + ' m³';
  }

  // --- Normal rows (sinal='+') ---
  body.querySelectorAll('tr[data-linha]').forEach(row => {
    const nome = row.dataset.linha;
    const ls = state.linhas[nome];
    const linha = linhaByNome[nome];
    if (!ls || !linha) return;

    const prodSel = row.querySelector('.field-prod');
    const pecasInp = row.querySelector('.field-pecas');
    const malInp = row.querySelector('.field-mal');

    function updateDerived() {
      const totP = (ls.malotes || 0) * (ls.pecas_por_malote || 0);
      row.querySelector('.cell-totpecas').textContent = totP || '-';
      const m3v = calcM3Entry(ls);
      row.querySelector('.cell-m3').textContent = m3v ? m3v.toFixed(3) + ' m³' : '-';
      updateTotals();
    }

    prodSel?.addEventListener('change', () => {
      ls.produto_stock = prodSel.value;
      const p = findMp(ls.produto_stock);
      if (p && (!ls.pecas_por_malote || ls.pecas_por_malote === 0)) { ls.pecas_por_malote = p.pecas_por_malote; pecasInp.value = p.pecas_por_malote; }
      if (p) pecasInp.placeholder = p.pecas_por_malote;
      persist(); updateDerived();

      // Helper: aplica produto + peças a uma linha-alvo e sincroniza a UI.
      // forceOverwrite=false → só preenche se a linha estiver vazia.
      function syncToTarget(targetName, forceOverwrite) {
        const tls = state.linhas[targetName];
        if (!tls) return;
        if (!forceOverwrite && tls.produto_stock) return; // não sobrescreve escolha do operador
        tls.produto_stock = ls.produto_stock;
        if (p) tls.pecas_por_malote = p.pecas_por_malote;
        persist();
        const tRow = body.querySelector(`tr[data-linha="${CSS.escape(targetName)}"]`);
        if (tRow) {
          const ts = tRow.querySelector('.field-prod');
          if (ts) {
            // Se a option não existe na allow-list da linha-alvo (ex: madeira 2ª
            // tem menos produtos que principal), cria a option em runtime para
            // o select poder mostrar o valor selecionado.
            if (ls.produto_stock && ![...ts.options].some(o => o.value === ls.produto_stock)) {
              const opt = document.createElement('option');
              opt.value = ls.produto_stock;
              opt.textContent = ls.produto_stock;
              ts.appendChild(opt);
            }
            ts.value = ls.produto_stock;
          }
          const tp2 = tRow.querySelector('.field-pecas'); if (tp2 && p) { tp2.value = p.pecas_por_malote; tp2.placeholder = p.pecas_por_malote; }
          const totEl = tRow.querySelector('.cell-totpecas');
          if (totEl) totEl.textContent = ((tls.malotes||0)*(tls.pecas_por_malote||0)) || '-';
          const m3El = tRow.querySelector('.cell-m3');
          if (m3El) { const v = calcM3Entry(tls); m3El.textContent = v ? v.toFixed(3)+' m³' : '-'; }
        }
        updateTotals();
      }

      // Auto-sync: principal T1/T3 → madeira 2ª T1/T3 (sempre força, é sub-linha vinculada)
      const m = nome.match(/^Linha principal (T\d)$/);
      if (m) {
        syncToTarget(`[+] Madeira de 2ª ${m[1]}`, true);
        // Adicional: T1 → sugere para T3 (principal + madeira 2ª), só se T3 estiver vazia
        if (m[1] === 'T1') {
          syncToTarget('Linha principal T3', false);
          syncToTarget('[+] Madeira de 2ª T3', false);
        }
      }

      // Auto-sync: aproveitamentos T1/T3 (opcional (B)) → madeira 2ª aprov T1/T3
      const ma = nome.match(/^Linha aproveitamentos (T\d)( \(B\))?$/);
      if (ma) {
        syncToTarget(`[+] Madeira de 2ª Aprov ${ma[1]}${ma[2] || ''}`, true);
        // Adicional: T1 → sugere para T3 (aproveitamentos + madeira 2ª aprov), só se T3 vazia
        if (ma[1] === 'T1' && !ma[2]) {
          syncToTarget('Linha aproveitamentos T3', false);
          syncToTarget('[+] Madeira de 2ª Aprov T3', false);
        }
      }
    });

    pecasInp?.addEventListener('change', () => { ls.pecas_por_malote = parseInt(pecasInp.value) || 0; persist(); updateDerived(); });

    row.querySelector('.btn-inc')?.addEventListener('click', () => { ls.malotes = (Number(ls.malotes)||0)+1; malInp.value = ls.malotes; persist(); updateDerived(); });
    row.querySelector('.btn-dec')?.addEventListener('click', () => { ls.malotes = Math.max(0,(Number(ls.malotes)||0)-1); malInp.value = ls.malotes; persist(); updateDerived(); });
    malInp?.addEventListener('change', () => { ls.malotes = Math.max(0, parseFloat(malInp.value)||0); malInp.value = ls.malotes; persist(); updateDerived(); });
    row.querySelector('.btn-duvida')?.addEventListener('click', () => {
      ls.duvida = !ls.duvida;
      persist(); renderMalotes(el, ctx);
    });
  });

  // --- Minus rows (sinal='-'): event delegation ---
  function getMinusContext(target) {
    const row = target.closest('tr[data-minus-linha], tr[data-minus-extra]');
    if (!row) return null;
    const nome = row.dataset.minusLinha || row.dataset.minusExtra;
    const idx = parseInt(row.dataset.eidx);
    const ls = state.linhas[nome];
    if (!ls || !ls.entries || !ls.entries[idx]) return null;
    return { nome, idx, entry: ls.entries[idx], ls };
  }

  body.addEventListener('change', (ev) => {
    const t = ev.target;
    const ctx2 = getMinusContext(t);
    if (!ctx2) return;
    const { nome, idx, entry } = ctx2;

    if (t.classList.contains('field-prod-m')) {
      entry.produto_stock = t.value;
      const p = findMp(entry.produto_stock);
      if (p && (!entry.pecas_por_malote || entry.pecas_por_malote === 0)) entry.pecas_por_malote = p.pecas_por_malote;
      persist(); renderMalotes(el, ctx); // re-render to update filtered dropdowns
    } else if (t.classList.contains('field-pecas-m')) {
      entry.pecas_por_malote = parseInt(t.value) || 0;
      persist(); updateTotals();
    } else if (t.classList.contains('field-mal-m')) {
      entry.malotes = Math.max(0, parseFloat(t.value) || 0);
      persist(); updateTotals();
    } else if (t.classList.contains('field-origem-m')) {
      entry.produto_origem = t.value;
      persist(); renderMalotes(el, ctx); // re-render to update filtered dropdowns
    } else if (t.classList.contains('field-mult-m')) {
      entry.multiplicador = Math.max(1, parseInt(t.value) || 1);
      persist(); renderMalotes(el, ctx);
    }
  });

  body.addEventListener('click', (ev) => {
    const t = ev.target;

    // Stepper +/- for minus entries
    const ctx2 = getMinusContext(t);
    if (ctx2) {
      if (t.classList.contains('btn-inc-m')) {
        ctx2.entry.malotes = (Number(ctx2.entry.malotes)||0)+1;
        persist(); renderMalotes(el, ctx);
      } else if (t.classList.contains('btn-dec-m')) {
        ctx2.entry.malotes = Math.max(0,(Number(ctx2.entry.malotes)||0)-1);
        persist(); renderMalotes(el, ctx);
      } else if (t.classList.contains('btn-remove-entry')) {
        const eidx = parseInt(t.dataset.eidx);
        ctx2.ls.entries.splice(eidx, 1);
        persist(); renderMalotes(el, ctx);
      } else if (t.classList.contains('btn-duvida-m')) {
        ctx2.entry.duvida = !ctx2.entry.duvida;
        persist(); renderMalotes(el, ctx);
      }
      return;
    }

    // Add entry button
    const addRow = t.closest('tr[data-minus-add]');
    if (addRow && t.classList.contains('btn-add-entry')) {
      const nome = addRow.dataset.minusAdd;
      state.linhas[nome].entries.push(emptyEntry());
      persist(); renderMalotes(el, ctx);
    }
  });

  // --- Global controls ---
  // Toggle aproveitamentos (B)
  const aprovBBtn = el.querySelector('#aprovBToggle');
  if (aprovBBtn) {
    aprovBBtn.addEventListener('click', () => {
      const prefs = loadUiPrefs();
      prefs.aprovBExpanded = !prefs.aprovBExpanded;
      saveUiPrefs(prefs);
      renderMalotes(el, ctx);
    });
  }

  el.querySelector('#dataReg').addEventListener('change', async (e) => {
    const newDate = e.target.value || hoje;
    state.data_registo = newDate;
    // Limpar produtos das linhas não-PSY antes do prefill, para que o pré-fill
    // da nova data seja aplicado mesmo onde já havia setup (a data mudou →
    // contexto diferente). Malotes/pecas_por_malote ficam.
    for (const l of linhasOrdenadas) {
      if (l.sinal === '-') continue;
      const ls = state.linhas[l.nome];
      ls.produto_stock = '';
    }
    persist();
    const n = await prefillFromDay(newDate, false);
    if (n > 0) toast(`✓ Pré-preenchidas ${n} linha(s) de ${newDate}`, 'success');
    else toast(`Sem registos para ${newDate}`, '');
    renderMalotes(el, ctx);
  });

  el.querySelector('#resetBtn').addEventListener('click', () => {
    if (!confirm('Apagar setup e quantidades atuais?')) return;
    clearState(userId); linhasCache = null; renderMalotes(el, ctx);
  });

  el.querySelector('#submitBtn').addEventListener('click', async () => {
    const entriesToSubmit = []; // "movimentos" entrada_producao
    const saidasRetestagem = []; // ajuste_saida das peças origem retestadas
    const sobrasReapov = []; // entrada_producao das sobras reaproveitáveis

    for (const l of linhasOrdenadas) {
      const ls = state.linhas[l.nome];
      const items = l.sinal === '-' ? (ls.entries || []) : [ls];

      for (const e of items) {
        if (!e.produto_stock) continue;
        const m = Number(e.malotes) || 0;
        if (m <= 0) continue;
        const np = Number(e.pecas_por_malote) || 0;
        if (np <= 0) { toast(`Peças/malote em falta na linha ${l.nome}`, 'error'); return; }
        const p = findMp(e.produto_stock);
        if (!p) continue;
        const vol1 = (p.comprimento/1000)*(p.largura/1000)*(p.espessura/1000);
        const entry = {
          tipo: 'entrada_producao', empresa: 'MCF',
          produto_stock: p.produto_stock, malotes: m, pecas_por_malote: np,
          m3: +(vol1*m*np).toFixed(4),
          operador_id: ctx.profile.id,
          incerteza: !!e.duvida,
          duvida_resolvida: !e.duvida,  // se há dúvida → fica pendente até admin validar
          data_registo: state.data_registo, linha: l.nome, turno: deriveTurno(l.nome),
        };
        if (e.produto_origem) entry.produto_origem = e.produto_origem;
        if (e.multiplicador && e.multiplicador > 0) entry.multiplicador = e.multiplicador;
        entry._duvida_flag = !!e.duvida; // marker temporário p/ pedir obs depois
        entry._linha_label = l.nome;
        entriesToSubmit.push(entry);

        // Retestagem (sinal='-' com produto_origem): gerar saida + sobra
        if (l.sinal === '-' && e.produto_origem && e.multiplicador > 0) {
          const pOrigem = findMp(e.produto_origem);
          if (pOrigem) {
            const outputPieces = m * np;
            const sourcePieces = outputPieces / e.multiplicador;
            const sourceMalotes = sourcePieces / (pOrigem.pecas_por_malote || 1);
            const volOrigem1 = (pOrigem.comprimento/1000)*(pOrigem.largura/1000)*(pOrigem.espessura/1000);
            saidasRetestagem.push({
              tipo: 'ajuste_saida', empresa: 'MCF',
              produto_stock: pOrigem.produto_stock,
              malotes: +sourceMalotes.toFixed(3),
              pecas_por_malote: pOrigem.pecas_por_malote || 1,
              m3: +(volOrigem1 * sourcePieces).toFixed(4),
              operador_id: ctx.profile.id, incerteza: false, duvida_resolvida: true,
              data_registo: state.data_registo, linha: l.nome, turno: deriveTurno(l.nome),
              justificacao: `Retestagem em ${l.nome} → ${m} malotes de ${p.produto_stock}`,
            });

            // Sobra reaproveitável (se aplicável)
            const sobra = calcSobra(e.produto_stock, e.produto_origem, e.multiplicador);
            if (sobra?.reaproveitavel && sobra.sku) {
              const pSobra = findMp(sobra.sku) || { produto_stock: sobra.sku, pecas_por_malote: 1 };
              const sobraComp = parseInt(sobra.sku.split('x')[0]);
              const sobraLarg = parseInt(sobra.sku.split('x')[1]);
              const sobraEsp = parseInt(sobra.sku.split('x')[2]);
              const volSobra1 = (sobraComp/1000)*(sobraLarg/1000)*(sobraEsp/1000);
              sobrasReapov.push({
                tipo: 'entrada_producao', empresa: 'MCF',
                produto_stock: pSobra.produto_stock,
                malotes: +sourceMalotes.toFixed(3),
                pecas_por_malote: pOrigem.pecas_por_malote || 1,
                m3: +(volSobra1 * sourcePieces).toFixed(4),
                operador_id: ctx.profile.id, incerteza: false, duvida_resolvida: true,
                data_registo: state.data_registo, linha: l.nome, turno: deriveTurno(l.nome),
                justificacao: `Sobra reaproveitável de ${e.produto_origem}`,
              });
            }
          }
        }
      }
    }

    // Meios malotes (peças soltas que não chegam a um malote completo)
    if (await confirmBig('📦 Há meios malotes a registar?', 'Peças soltas que não chegam a um malote completo.', 'Sim, há', 'Não há')) {
      const meios = await askMeiosMalotesModal({ linhas: linhasOrdenadas, mp, state, allowMap });
      for (const mm of (meios || [])) {
        const l = linhaByNome[mm.linha];
        const p = findMp(mm.produto_stock);
        if (!l || !p) continue;
        const ppm = p.pecas_por_malote || 0;
        if (!ppm) { toast(`Peças/malote = 0 em ${p.produto_stock}`, 'error'); continue; }
        const m = mm.pecas / ppm; // malotes fracionários (ex: 100 peças / 400 = 0.25)
        const vol1 = (p.comprimento/1000)*(p.largura/1000)*(p.espessura/1000);
        const entry = {
          tipo: 'entrada_producao', empresa: 'MCF',
          produto_stock: p.produto_stock,
          malotes: +m.toFixed(4),
          pecas_por_malote: ppm,
          m3: +(vol1 * mm.pecas).toFixed(4),
          operador_id: ctx.profile.id,
          incerteza: false, duvida_resolvida: true,
          data_registo: state.data_registo,
          linha: l.nome, turno: deriveTurno(l.nome),
          justificacao: `Meio malote (${mm.pecas} peças)`,
        };
        entry._linha_label = l.nome;
        entriesToSubmit.push(entry);
      }
    }

    if (entriesToSubmit.length === 0) { toast('Sem malotes para submeter.', 'error'); return; }

    // Calcular rolaria (tons + gama) para cada movimento principal usando o algoritmo partilhado
    try {
      // Carregar lookups
      const [gamasRes, matrizRes, configRes] = await Promise.all([
        supabase.from('rolaria_gamas').select('*').eq('ativo', true),
        supabase.from('rolaria_matriz_principal').select('*'),
        supabase.from('consumo_config').select('valor').eq('chave', 'ratio_ton_m3').maybeSingle(),
      ]);
      const ratio = Number(configRes.data?.valor) || 2.129925;
      const gamas = gamasRes.data || [];
      const matriz = matrizRes.data || [];

      // Fetch principal movimentos da semana (para fallback weekly)
      const d = new Date(state.data_registo + 'T00:00:00Z');
      const dow = d.getUTCDay() || 7;
      const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - (dow - 1));
      const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
      const { data: weekMovs } = await supabase.from('movimentos')
        .select('linha, turno, data_registo, produto_stock, m3')
        .eq('tipo', 'entrada_producao').eq('empresa', 'MCF')
        .eq('estornado', false).eq('duvida_resolvida', true)
        .not('linha', 'is', null)
        .gte('data_registo', mon.toISOString().slice(0,10))
        .lte('data_registo', sun.toISOString().slice(0,10));

      const fallback = computeWeeklyFallbackGama(
        [...(weekMovs || []), ...entriesToSubmit],
        { ratio, gamas, matriz, linhas: linhasOrdenadas, mp }
      );
      const rolariaMap = computeRolariaPerEntry(entriesToSubmit, {
        ratio, gamas, matriz, linhas: linhasOrdenadas, mp, weeklyFallbackGama: fallback,
      });

      // Identificar entries com tons > 0 mas sem gama atribuída → pedir manualmente
      const needsManual = [];
      for (let i = 0; i < entriesToSubmit.length; i++) {
        const info = rolariaMap.get(i);
        if (info && info.tons > 0) {
          entriesToSubmit[i].rolaria_tons = +info.tons.toFixed(3);
          if (info.gama) {
            entriesToSubmit[i].rolaria_gama = info.gama;
          } else {
            needsManual.push(i);
          }
        }
      }

      // Se há entries sem gama, mostrar modal para o operador escolher
      // (filtrado por comprimento do produto: 1000→2100, 1200→2500, 800→2600)
      if (needsManual.length > 0) {
        for (const idx of needsManual) {
          const entry = entriesToSubmit[idx];
          const produto = mp.find(x => x.produto_stock === entry.produto_stock);
          const compProduto = produto?.comprimento || 0;
          // Filtrar gamas elegíveis pela comp do produto → comp_rolaria
          // 1000 → 2100; 1200 → 2500; 800 → 2600; charriot prods (2100/2500/2600/2750) → exact match
          let elegiveis = gamas;
          if ([800, 1000, 1200].includes(compProduto)) {
            const compRol = compProduto === 1000 ? 2100 : compProduto === 1200 ? 2500 : 2600;
            elegiveis = gamas.filter(g => g.comp_rolaria_mm === compRol);
          } else if ([2100, 2500, 2600, 2750].includes(compProduto)) {
            elegiveis = gamas.filter(g => g.comp_rolaria_mm === compProduto);
          }
          // Senão (comp atípico) → mostra todas
          const choice = await pickGamaModal({
            linha: entry.linha,
            produto: entry.produto_stock,
            tons: entry.rolaria_tons,
            gamas: elegiveis,
            allGamas: gamas,
          });
          if (choice === null) {
            toast('Submissão cancelada — gama em falta', 'error');
            return;
          }
          entry.rolaria_gama = choice;
        }
      }
    } catch (err) {
      console.warn('Erro a calcular rolaria (prossegue sem):', err);
    }

    // Modal para entries marcadas com dúvida — pedir descrição
    const duvidaEntries = entriesToSubmit.filter(e => e._duvida_flag);
    if (duvidaEntries.length > 0) {
      const obs = await askDuvidasModal(duvidaEntries);
      if (obs === null) { toast('Submissão cancelada', 'error'); return; }
      // Aplicar obs em cada entry com dúvida
      for (let i = 0; i < duvidaEntries.length; i++) {
        const text = obs[i] || '';
        duvidaEntries[i].justificacao = text ? `Dúvida: ${text}` : 'Dúvida (sem descrição)';
      }
    }
    // Limpar markers temporários
    for (const e of entriesToSubmit) { delete e._duvida_flag; delete e._linha_label; }

    const nDuvidas = duvidaEntries.length;
    const totalToSubmit = entriesToSubmit.length + saidasRetestagem.length + sobrasReapov.length;
    const msg = `Submeter ${totalToSubmit} registo(s) — ${entriesToSubmit.length} produção${nDuvidas ? ` (${nDuvidas} c/ dúvida)` : ''}${saidasRetestagem.length ? ` + ${saidasRetestagem.length} saídas retestagem` : ''}${sobrasReapov.length ? ` + ${sobrasReapov.length} sobras` : ''} — total ${entriesToSubmit.reduce((s,e)=>s+e.m3,0).toFixed(2)} m³?`;
    if (!confirm(msg)) return;

    const btn = el.querySelector('#submitBtn');
    btn.disabled = true; btn.textContent = 'A submeter...';
    let offline = 0, online = 0;
    for (const entry of [...entriesToSubmit, ...saidasRetestagem, ...sobrasReapov]) {
      const res = await addMovimento(entry);
      if (res.offline) offline++; else online++;
    }
    btn.disabled = false; btn.textContent = '✓ Submeter turno';
    toast(offline > 0 ? `✓ ${online} submetidos, ${offline} em fila offline` : `✓ ${online} registos submetidos`, 'success');

    // Reset malotes + duvida mas manter setup (produto)
    for (const l of linhasOrdenadas) {
      const ls = state.linhas[l.nome];
      if (l.sinal === '-') {
        for (const e of (ls.entries||[])) { e.malotes = 0; e.duvida = false; }
      } else {
        ls.malotes = 0; ls.duvida = false;
      }
    }
    persist(); renderMalotes(el, ctx);
    window.dispatchEvent(new CustomEvent('sync-done'));
  });

  updateTotals();
}

// =========================================================
// Modal: descrever dúvidas para cada entry marcada
// Retorna array de obs (mesma ordem que entries), ou null se cancelar
// =========================================================
function askDuvidasModal(entries) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:600px;max-height:80vh;overflow-y:auto">
        <h3>❓ Dúvidas registadas (${entries.length})</h3>
        <p class="sub" style="margin-bottom:14px">
          Para cada registo marcado com dúvida, descreve qual o produto que pensas
          que era correto. Estes registos ficam pendentes na tab <b>Dúvidas</b>
          até um admin validar — e só depois afetam o inventário.
        </p>
        ${entries.map((e, i) => `
          <div style="background:#fff8e1;padding:12px;border-radius:10px;margin-bottom:10px">
            <div style="font-size:.85rem;color:#666;margin-bottom:6px">
              <b>${e._linha_label}</b> · ${e.malotes} malotes · escolhido: <b>${e.produto_stock}</b>
            </div>
            <input type="text" data-obs-idx="${i}" placeholder="O que pensavas que era? (ex.: 1200x95x18 em vez de 1200x98x18)"
              style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem">
          </div>
        `).join('')}
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn-secondary" id="cancelBtn">Cancelar</button>
          <button class="btn btn-success" id="okBtn">✓ Submeter c/ dúvidas</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#cancelBtn').onclick = () => { overlay.remove(); resolve(null); };
    overlay.querySelector('#okBtn').onclick = () => {
      const obs = entries.map((_, i) => overlay.querySelector(`[data-obs-idx="${i}"]`).value.trim());
      overlay.remove();
      resolve(obs);
    };
  });
}

// =========================================================
// Modal: pedir ao operador a gama de rolaria consumida
// (Quando algoritmo não consegue determinar — ex.: aprov sem principal
//  no turno, ou principal com costaneiro desconhecido)
// =========================================================
function pickGamaModal({ linha, produto, tons, gamas, allGamas }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    let showAll = false;
    function render() {
      const list = (showAll ? allGamas : gamas).slice().sort((a, b) =>
        (a.comp_rolaria_mm - b.comp_rolaria_mm) || (a.diam_min_mm - b.diam_min_mm) || a.nome.localeCompare(b.nome)
      );
      overlay.innerHTML = `
        <div class="modal" style="max-width:560px">
          <h3>🪵 Gama de rolaria consumida</h3>
          <p class="sub" style="margin-bottom:14px">
            Não consegui determinar automaticamente a gama de rolaria para este registo
            (provavelmente porque a linha principal não foi registada neste turno).
            Indica que rolaria foi consumida:
          </p>
          <div style="background:#f5f5f7;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:.9rem">
            <div><b>Linha:</b> ${linha}</div>
            <div><b>Produto:</b> ${produto}</div>
            <div><b>Tons rolaria:</b> ${Number(tons).toFixed(2)}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:380px;overflow-y:auto">
            ${list.length === 0
              ? '<p style="color:#888;text-align:center;padding:14px">Sem gamas elegíveis para este comprimento.</p>'
              : list.map(g => `<button type="button" data-gama="${g.nome.replace(/"/g,'&quot;')}" style="padding:10px 14px;background:#fff;border:2px solid var(--color-border);border-radius:10px;cursor:pointer;text-align:left;font-size:.9rem">${g.nome} <span style="color:#888;font-size:.78rem">(${g.categoria})</span></button>`).join('')
            }
          </div>
          <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;gap:10px">
            <label style="font-size:.85rem;color:#666;display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="showAll" ${showAll ? 'checked' : ''}>
              Mostrar todas as gamas (raro)
            </label>
            <button class="btn btn-secondary" id="cancelBtn">Cancelar</button>
          </div>
        </div>
      `;
      overlay.querySelector('#showAll').addEventListener('change', e => { showAll = e.target.checked; render(); });
      overlay.querySelector('#cancelBtn').addEventListener('click', () => { overlay.remove(); resolve(null); });
      overlay.querySelectorAll('button[data-gama]').forEach(b => {
        b.addEventListener('click', () => { overlay.remove(); resolve(b.dataset.gama); });
      });
    }
    document.body.appendChild(overlay);
    render();
  });
}

// =========================================================
// Confirmação in-app com botões grandes (tablet-friendly)
// =========================================================
function confirmBig(titulo, subtitulo, labelSim = 'Sim', labelNao = 'Não') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;text-align:center;padding:28px 24px">
        <h3 style="margin:0 0 10px;font-size:1.4rem">${titulo}</h3>
        ${subtitulo ? `<p style="color:#555;font-size:1rem;margin:0 0 24px;line-height:1.4">${subtitulo}</p>` : ''}
        <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap">
          <button type="button" id="cbNao" style="flex:1;min-width:140px;padding:18px 28px;font-size:1.1rem;font-weight:700;border:2px solid #d2d2d7;background:#fff;color:#1d1d1f;border-radius:14px;cursor:pointer;touch-action:manipulation">${labelNao}</button>
          <button type="button" id="cbSim" style="flex:1;min-width:140px;padding:18px 28px;font-size:1.1rem;font-weight:700;border:none;background:var(--color-blue);color:#fff;border-radius:14px;cursor:pointer;touch-action:manipulation;box-shadow:0 2px 8px rgba(0,122,255,.3)">${labelSim}</button>
        </div>
      </div>
    `;
    overlay.querySelector('#cbSim').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.querySelector('#cbNao').addEventListener('click', () => { overlay.remove(); resolve(false); });
    document.body.appendChild(overlay);
  });
}

// =========================================================
// Modal: meios malotes (peças soltas) — só linhas principal/aproveitamentos/charriot
// Retorna array de {linha, produto_stock, pecas} (apenas com pecas > 0), ou [] se cancelar.
// =========================================================
function askMeiosMalotesModal({ linhas, mp, state, allowMap }) {
  return new Promise(resolve => {
    const groupOf = (nome) => {
      if (nome.startsWith('Linha principal') || /^\[\+\] Madeira de 2ª T\d$/.test(nome)) return 'principal';
      if (nome.includes('charriot')) return 'charriot';
      if (nome.startsWith('Linha aproveitamentos') || nome.startsWith('[+] Madeira de 2ª Aprov')) return 'aproveitamentos';
      return 'other';
    };
    const relevant = linhas.filter(l => ['principal','aproveitamentos','charriot'].includes(groupOf(l.nome)));
    const findMp = (sku) => mp.find(p => p.produto_stock === sku);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:780px;max-height:88vh;overflow-y:auto">
        <h3>📦 Meios malotes — peças soltas</h3>
        <p class="sub">Indica o nº de peças por linha. São convertidas automaticamente em malotes fracionários (peças ÷ peças/malote). Linhas em branco são ignoradas.</p>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.85rem">
            <thead><tr style="background:#f5f5f7">
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e0e0e0">Linha</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e0e0e0">Produto</th>
              <th style="text-align:center;padding:8px;border-bottom:2px solid #e0e0e0;width:110px">Nº peças</th>
              <th style="text-align:right;padding:8px;border-bottom:2px solid #e0e0e0;width:90px">≈ malotes</th>
            </tr></thead>
            <tbody id="mmBody"></tbody>
          </table>
        </div>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn-secondary" id="mmCancel">Saltar (sem meios)</button>
          <button class="btn btn-primary" id="mmOk">✓ Aplicar</button>
        </div>
      </div>
    `;

    const body = overlay.querySelector('#mmBody');
    body.innerHTML = relevant.map(l => {
      const ls = state.linhas[l.nome];
      const defaultProd = ls?.produto_stock || '';
      const allow = allowMap[l.nome];
      const pool = (allow && allow.size > 0)
        ? mp.filter(p => allow.has(p.produto_stock))
        : (l.categoria ? mp.filter(p => p.categoria === l.categoria) : mp);
      const isSub = /^\[\+\] Madeira de 2ª/.test(l.nome);
      return `
        <tr data-linha="${l.nome}" ${isSub ? 'style="background:#fef9f0"' : ''}>
          <td style="padding:6px 8px;font-size:.8rem;${isSub?'padding-left:22px;color:#888':''}">${l.nome}</td>
          <td style="padding:6px 8px">
            <select class="mm-prod" style="width:100%;padding:6px;border:1px solid var(--color-border);border-radius:6px;font-size:.82rem">
              <option value="">— Nenhum —</option>
              ${pool.map(p => `<option value="${p.produto_stock}" ${p.produto_stock===defaultProd?'selected':''}>${p.produto_stock}</option>`).join('')}
            </select>
          </td>
          <td style="padding:6px 8px;text-align:center">
            <input type="number" class="mm-pecas" min="0" step="1" placeholder="0" style="width:90px;padding:6px;border:1px solid var(--color-border);border-radius:6px;font-size:.95rem;text-align:center;font-weight:600">
          </td>
          <td style="padding:6px 8px;text-align:right;color:#666;font-size:.8rem" class="mm-calc">—</td>
        </tr>
      `;
    }).join('');

    function recalcRow(tr) {
      const prod = tr.querySelector('.mm-prod').value;
      const pecas = parseInt(tr.querySelector('.mm-pecas').value) || 0;
      const cell = tr.querySelector('.mm-calc');
      if (!prod || !pecas) { cell.textContent = '—'; cell.style.color = '#666'; return; }
      const p = findMp(prod);
      const ppm = p?.pecas_por_malote || 0;
      if (!ppm) { cell.textContent = '⚠ ppm=0'; cell.style.color = '#c0392b'; return; }
      cell.style.color = '#1f7a3a';
      cell.textContent = (pecas / ppm).toFixed(3);
    }
    body.addEventListener('input', (ev) => { const tr = ev.target.closest('tr'); if (tr) recalcRow(tr); });
    body.addEventListener('change', (ev) => { const tr = ev.target.closest('tr'); if (tr) recalcRow(tr); });

    overlay.querySelector('#mmCancel').onclick = () => { overlay.remove(); resolve([]); };
    overlay.querySelector('#mmOk').onclick = () => {
      const out = [];
      body.querySelectorAll('tr[data-linha]').forEach(tr => {
        const linha = tr.dataset.linha;
        const produto_stock = tr.querySelector('.mm-prod').value;
        const pecas = parseInt(tr.querySelector('.mm-pecas').value) || 0;
        if (produto_stock && pecas > 0) out.push({ linha, produto_stock, pecas });
      });
      overlay.remove();
      resolve(out);
    };
    document.body.appendChild(overlay);
  });
}
