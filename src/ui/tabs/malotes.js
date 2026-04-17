// Registos Produção MCF — grelha "turno-style"
// - Linhas normais (sinal='+'): 1 produto por linha
// - Linhas sinal='-' (PSY, Aprov-Sobras): multi-produto (entries array, botão "+")
// - Sub-linhas madeira 2ª: indentadas visualmente sob principal/aproveitamentos
// - Auto-save a cada interação (localStorage)

import { supabase } from '../../supabase.js';
import { toast } from '../app.js';
import { addMovimento, cachePut, cacheGet } from '../../offline.js';

// =========================================================
// Caches
// =========================================================
let mpCache = null;
let linhasCache = null;
let alturasCache = null;
let compatCache = null;

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

function emptyEntry() { return { produto_stock: '', pecas_por_malote: 0, malotes: 0, produto_origem: '', multiplicador: 1 }; }

// =========================================================
// Render
// =========================================================
export async function renderMalotes(el, ctx) {
  el.innerHTML = `<div class="card"><h2>📦 Registos Produção MCF</h2><p class="sub">A carregar...</p></div>`;
  const [mp, linhas, alturasMenores, compatMap] = await Promise.all([loadMP(), loadLinhasMCF(), loadAlturasMenores(), loadCompat()]);
  const linhasOrdenadas = linhas;

  const userId = ctx.profile.id;
  const hoje = new Date().toISOString().slice(0, 10);
  let state = loadState(userId);

  // Reset diário
  if (!state || state.data_registo !== hoje) {
    state = { data_registo: hoje, turno: state?.turno || 'T1', linhas: {} };
    for (const l of linhasOrdenadas) {
      state.linhas[l.nome] = l.sinal === '-' ? { entries: [emptyEntry()] } : { produto_stock: '', pecas_por_malote: 0, malotes: 0 };
    }
    saveState(userId, state);
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

  function produtoOptionsForMinus(origemStock, selected) {
    const pSrc = findMp(origemStock);
    return minusPool.filter(p => {
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
    const produtos = produtosDaLinha(linha);
    const suggest = findMp(ls.produto_stock);
    const defPecas = suggest ? suggest.pecas_por_malote : 0;
    const malotes = ls.malotes || 0;
    const m3v = calcM3Entry(ls);
    const totPecas = malotes * (ls.pecas_por_malote || 0);
    const isSub = isSubLine(linha.nome);
    const nameStyle = isSub ? 'padding:4px 8px 10px 30px;font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px;vertical-align:top' : 'padding:10px;font-weight:600;white-space:nowrap';
    const rowStyle = isSub ? 'background:#fef9f0' : '';
    const displayName = isSub ? subLineLabel(linha.nome) : linha.nome;

    return `
      <tr data-linha="${linha.nome}" style="${rowStyle}">
        <td style="${nameStyle}">${displayName}</td>
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
      const nameCell = idx === 0
        ? `<td style="padding:10px;font-weight:600;white-space:nowrap;vertical-align:top">${linha.nome}</td>`
        : `<td style="padding:10px"></td>`;
      const rowBorder = idx > 0 ? 'border-top:1px dashed #ddd' : '';
      html += `
        <tr data-minus-linha="${linha.nome}" data-eidx="${idx}" style="${rowBorder}">
          ${nameCell}
          <td style="padding:8px">
            <select class="field-prod-m" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem">
              <option value="">— Escolher produto —</option>
              ${produtoOptionsForMinus(e.produto_origem, e.produto_stock)}
            </select>
          </td>
          <td style="padding:8px;width:100px">
            <input type="number" class="field-pecas-m" min="0" step="1" value="${e.pecas_por_malote || ''}" placeholder="${defPecas || '-'}" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:.95rem;text-align:center;font-weight:600">
          </td>
          <td style="padding:8px">
            <div style="display:flex;align-items:center;justify-content:center;gap:6px">
              <button type="button" class="btn-dec-m" style="width:44px;height:44px;border:2px solid var(--color-blue);background:#fff;color:var(--color-blue);border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">−</button>
              <input type="number" class="field-mal-m" min="0" step="0.5" value="${malotes}" style="width:80px;padding:10px;border:2px solid var(--color-border);border-radius:10px;text-align:center;font-size:1.2rem;font-weight:700">
              <button type="button" class="btn-inc-m" style="width:44px;height:44px;border:2px solid var(--color-blue);background:var(--color-blue);color:#fff;border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">+</button>
            </div>
          </td>
          <td style="padding:8px;text-align:center;font-weight:600;color:#1d1d1f">${totPecas || '-'}</td>
          <td style="padding:8px;text-align:center;font-weight:600;color:#495057">
            ${m3v ? m3v.toFixed(3) + ' m³' : '-'}
            ${entries.length > 1 ? `<button type="button" class="btn-remove-entry" data-eidx="${idx}" style="margin-left:4px;background:none;border:none;color:#c0392b;cursor:pointer;font-size:.9rem" title="Remover">&times;</button>` : ''}
          </td>
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
          <thead><tr style="background:#f5f5f7">
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Linha</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Produto</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Peças/malote</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Nº malotes</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">Total peças</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0">m³</th>
          </tr></thead>
          <tbody id="grelhaBody">${(() => {
            let out = '';
            let prevGroup = null;
            for (const l of linhasOrdenadas) {
              const g = groupOf(l.nome);
              if (g !== prevGroup) {
                if (prevGroup !== null) out += separatorRow();
                out += groupHeaderRow(g);
              }
              // Tag each data-* row with data-grp="<group>" for CSS left-edge color
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

      // Auto-sync: principal T1/T3 → madeira 2ª T1/T3
      const m = nome.match(/^Linha principal (T\d)$/);
      if (m) {
        const target = `[+] Madeira de 2ª ${m[1]}`;
        const tls = state.linhas[target];
        if (tls) {
          tls.produto_stock = ls.produto_stock;
          if (p) tls.pecas_por_malote = p.pecas_por_malote;
          persist();
          const tRow = body.querySelector(`tr[data-linha="${CSS.escape(target)}"]`);
          if (tRow) {
            const ts = tRow.querySelector('.field-prod'); if (ts) ts.value = ls.produto_stock;
            const tp2 = tRow.querySelector('.field-pecas'); if (tp2 && p) { tp2.value = p.pecas_por_malote; tp2.placeholder = p.pecas_por_malote; }
            const totEl = tRow.querySelector('.cell-totpecas');
            if (totEl) totEl.textContent = ((tls.malotes||0)*(tls.pecas_por_malote||0)) || '-';
            const m3El = tRow.querySelector('.cell-m3');
            if (m3El) { const v = calcM3Entry(tls); m3El.textContent = v ? v.toFixed(3)+' m³' : '-'; }
          }
          updateTotals();
        }
      }

      // Auto-sync: aproveitamentos T1/T3 → madeira 2ª aprov T1/T3
      const ma = nome.match(/^Linha aproveitamentos (T\d)$/);
      if (ma) {
        const target = `[+] Madeira de 2ª Aprov ${ma[1]}`;
        const tls = state.linhas[target];
        if (tls) {
          tls.produto_stock = ls.produto_stock;
          if (p) tls.pecas_por_malote = p.pecas_por_malote;
          persist();
          const tRow = body.querySelector(`tr[data-linha="${CSS.escape(target)}"]`);
          if (tRow) {
            const ts = tRow.querySelector('.field-prod'); if (ts) ts.value = ls.produto_stock;
            const tp2 = tRow.querySelector('.field-pecas'); if (tp2 && p) { tp2.value = p.pecas_por_malote; tp2.placeholder = p.pecas_por_malote; }
          }
          updateTotals();
        }
      }
    });

    pecasInp?.addEventListener('change', () => { ls.pecas_por_malote = parseInt(pecasInp.value) || 0; persist(); updateDerived(); });

    row.querySelector('.btn-inc')?.addEventListener('click', () => { ls.malotes = (Number(ls.malotes)||0)+1; malInp.value = ls.malotes; persist(); updateDerived(); });
    row.querySelector('.btn-dec')?.addEventListener('click', () => { ls.malotes = Math.max(0,(Number(ls.malotes)||0)-1); malInp.value = ls.malotes; persist(); updateDerived(); });
    malInp?.addEventListener('change', () => { ls.malotes = Math.max(0, parseFloat(malInp.value)||0); malInp.value = ls.malotes; persist(); updateDerived(); });
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
  el.querySelector('#dataReg').addEventListener('change', (e) => { state.data_registo = e.target.value || hoje; persist(); });
  el.querySelector('#turnoSel').addEventListener('change', (e) => { state.turno = e.target.value; persist(); });

  el.querySelector('#resetBtn').addEventListener('click', () => {
    if (!confirm('Apagar setup e quantidades atuais?')) return;
    clearState(userId); linhasCache = null; renderMalotes(el, ctx);
  });

  el.querySelector('#submitBtn').addEventListener('click', async () => {
    const entriesToSubmit = [];

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
          operador_id: ctx.profile.id, incerteza: false, duvida_resolvida: true,
          data_registo: state.data_registo, linha: l.nome, turno: state.turno,
        };
        if (e.produto_origem) entry.produto_origem = e.produto_origem;
        if (e.multiplicador && e.multiplicador > 0) entry.multiplicador = e.multiplicador;
        entriesToSubmit.push(entry);
      }
    }

    if (entriesToSubmit.length === 0) { toast('Sem malotes para submeter.', 'error'); return; }
    if (!confirm(`Submeter ${entriesToSubmit.length} registo(s) — total ${entriesToSubmit.reduce((s,e)=>s+e.m3,0).toFixed(2)} m³?`)) return;

    const btn = el.querySelector('#submitBtn');
    btn.disabled = true; btn.textContent = 'A submeter...';
    let offline = 0, online = 0;
    for (const entry of entriesToSubmit) {
      const res = await addMovimento(entry);
      if (res.offline) offline++; else online++;
    }
    btn.disabled = false; btn.textContent = '✓ Submeter turno';
    toast(offline > 0 ? `✓ ${online} submetidos, ${offline} em fila offline` : `✓ ${online} registos submetidos`, 'success');

    // Reset malotes mas manter setup
    for (const l of linhasOrdenadas) {
      const ls = state.linhas[l.nome];
      if (l.sinal === '-') { for (const e of (ls.entries||[])) e.malotes = 0; }
      else ls.malotes = 0;
    }
    persist(); renderMalotes(el, ctx);
    window.dispatchEvent(new CustomEvent('sync-done'));
  });

  updateTotals();
}
