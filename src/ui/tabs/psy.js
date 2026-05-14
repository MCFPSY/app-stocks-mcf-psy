// Registos Produção PSY — grelha turno-style com multi-produto por linha
// - Data + Turno (T1/T2) no topo
// - Cada linha: N entries, cada entry = { produto, quantidade }. Botão "+" adiciona. "×" remove (se >1).
// - Target por (linha, produto) do histórico (psy_benchmark) mostrado junto à qtd
// - Auto-save em localStorage

import { supabase } from '../../supabase.js';
import { toast } from '../app.js';
import { addMovimento } from '../../offline.js';

let linhasCache = null;
let produtosCache = null;
let benchmarkCache = null;

async function loadLinhas() {
  if (linhasCache) return linhasCache;
  const { data } = await supabase.from('psy_linhas').select('*').eq('ativo', true).order('ordem');
  linhasCache = data || [];
  return linhasCache;
}

async function loadProdutos() {
  if (produtosCache) return produtosCache;
  const { data } = await supabase.from('psy_produtos').select('nome').eq('ativo', true).order('nome');
  produtosCache = (data || []).map(p => p.nome);
  return produtosCache;
}

async function loadBenchmark() {
  if (benchmarkCache) return benchmarkCache;
  const { data } = await supabase.from('psy_benchmark').select('linha, produto, target_qtd');
  const m = {};
  for (const r of (data || [])) m[`${r.linha}|${r.produto}`] = r.target_qtd;
  benchmarkCache = m;
  return m;
}

// ==========================================================
// Estado
// ==========================================================
function storageKey(userId) { return `mcfpsy-psy-turno-${userId}`; }
function loadState(userId) { try { const r = localStorage.getItem(storageKey(userId)); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveState(userId, state) { try { localStorage.setItem(storageKey(userId), JSON.stringify(state)); } catch (e) { console.warn('saveState', e); } }
function clearState(userId) { localStorage.removeItem(storageKey(userId)); }

function emptyEntry() { return { produto: '', quantidade: 0 }; }

// ==========================================================
// Render
// ==========================================================
export async function renderPSY(el, ctx) {
  el.innerHTML = `<div class="card"><h2>🏭 Registos Produção PSY</h2><p class="sub">A carregar setup do turno...</p></div>`;
  const [linhas, produtos, benchmark] = await Promise.all([loadLinhas(), loadProdutos(), loadBenchmark()]);
  const produtoSet = new Set(produtos);

  const userId = ctx.profile.id;
  const hoje = new Date().toISOString().slice(0, 10);
  let state = loadState(userId);

  if (!state || state.data_registo !== hoje) {
    state = { data_registo: hoje, turno: state?.turno || 'T1', desvio_objetivo: '', linhas: {} };
    for (const l of linhas) state.linhas[l.nome] = { entries: [emptyEntry()] };
    saveState(userId, state);
  }

  // Migrar / garantir
  for (const l of linhas) {
    if (!state.linhas[l.nome]) state.linhas[l.nome] = { entries: [emptyEntry()] };
    // Migrar formato antigo (flat { produto, quantidade }) → { entries: [...] }
    if (!state.linhas[l.nome].entries) {
      const old = state.linhas[l.nome];
      state.linhas[l.nome] = { entries: [{ produto: old.produto || '', quantidade: old.quantidade || 0 }] };
    }
  }

  function targetFor(linha, produto) {
    if (!produto) return null;
    return benchmark[`${linha}|${produto}`] || null;
  }

  // ==========================================================
  // Build HTML
  // ==========================================================
  function lineHTML(linha) {
    const ls = state.linhas[linha.nome];
    const entries = ls.entries || [emptyEntry()];
    let html = '';

    for (let idx = 0; idx < entries.length; idx++) {
      const e = entries[idx];
      const qty = e.quantidade || 0;
      const target = targetFor(linha.nome, e.produto);
      const pctColor = target && qty > 0 ? (qty / target >= 1 ? '#1f7a3a' : qty / target >= 0.7 ? '#ad8b00' : '#c0392b') : '#888';

      const isFirst = idx === 0;
      const nameCell = isFirst
        ? `<td style="padding:10px;font-weight:600;white-space:nowrap;vertical-align:top">${linha.nome}</td>`
        : `<td style="padding:10px"></td>`;
      const rowBorder = idx > 0 ? 'border-top:1px dashed #e8e8e8' : '';

      html += `
        <tr data-linha="${linha.nome}" data-eidx="${idx}" style="${rowBorder}">
          ${nameCell}
          <td style="padding:8px">
            <input type="text" class="field-prod" list="psyProdList" value="${(e.produto || '').replace(/"/g, '&quot;')}" placeholder="Tipo de palete..."
              style="width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem">
          </td>
          <td style="padding:8px">
            <div style="display:flex;align-items:center;justify-content:center;gap:6px">
              <button type="button" class="btn-dec" style="width:44px;height:44px;border:2px solid var(--color-blue);background:#fff;color:var(--color-blue);border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">−</button>
              <input type="number" class="field-qty" min="0" step="1" value="${qty}" style="width:80px;padding:10px;border:2px solid var(--color-border);border-radius:10px;text-align:center;font-size:1.2rem;font-weight:700">
              <button type="button" class="btn-inc" style="width:44px;height:44px;border:2px solid var(--color-blue);background:var(--color-blue);color:#fff;border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">+</button>
            </div>
          </td>
          <td style="padding:8px;text-align:center;color:${pctColor};min-width:120px">
            ${target ? `<div style="font-size:1.05rem;font-weight:600">🎯 ${target}</div>${qty > 0 ? `<div style="font-size:1.4rem;font-weight:800;line-height:1.1;margin-top:2px">${Math.round(qty / target * 100)}%</div>` : ''}` : '<span style="color:#ccc">—</span>'}
          </td>
          <td style="padding:8px;text-align:center;width:40px">
            ${entries.length > 1 ? `<button type="button" class="btn-remove-entry" title="Remover" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:1.1rem;padding:4px 8px">&times;</button>` : ''}
          </td>
        </tr>`;
    }

    // Add-entry row
    html += `
      <tr data-linha-add="${linha.nome}" style="background:#fafafa">
        <td></td>
        <td colspan="4" style="padding:4px 8px 10px">
          <button type="button" class="btn-add-entry" style="padding:4px 14px;background:#fff;border:2px dashed var(--color-blue);color:var(--color-blue);border-radius:8px;font-size:1rem;cursor:pointer;font-weight:700">+</button>
        </td>
      </tr>`;

    return html;
  }

  el.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">🏭 Registos Produção PSY</h2>
        <span class="sync-pill" id="psyAutoSave" style="padding:4px 10px;background:#eef7ee;color:#1f7a3a;border-radius:999px;font-size:.75rem;font-weight:600">✓ Guardado</span>
      </div>
      <p class="sub">Por defeito uma linha produz um produto, mas podes clicar <b>+</b> para adicionar mais. Target = máximo histórico por turno para a referência.</p>

      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="field" style="min-width:160px">
          <label>Data</label>
          <input type="date" id="psyDataReg" value="${state.data_registo}" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
        </div>
        <div class="field" style="min-width:120px">
          <label>Turno</label>
          <select id="psyTurnoSel" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
            <option value="T1" ${state.turno==='T1'?'selected':''}>T1</option>
            <option value="T2" ${state.turno==='T2'?'selected':''}>T2</option>
          </select>
        </div>
      </div>

      <datalist id="psyProdList">
        ${produtos.map(p => `<option value="${p.replace(/"/g, '&quot;')}"></option>`).join('')}
      </datalist>

      <div style="overflow-x:auto">
        <table id="psyGrelha" style="width:100%;border-collapse:collapse;min-width:760px;font-size:.9rem">
          <thead><tr style="background:#f5f5f7">
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0;width:120px">Linha</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Tipo de palete</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0;width:240px">Quantidade</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0;width:120px">Target</th>
            <th style="padding:10px;border-bottom:2px solid #e0e0e0;width:40px"></th>
          </tr></thead>
          <tbody id="psyGrelhaBody">${linhas.map(lineHTML).join('')}</tbody>
          <tfoot><tr style="background:#f0f7ff;font-weight:700">
            <td colspan="2" style="padding:12px;border-top:2px solid var(--color-blue)">Total</td>
            <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="psyTotQty">0 unid</td>
            <td colspan="2" style="border-top:2px solid var(--color-blue)"></td>
          </tr></tfoot>
        </table>
      </div>

      <div class="field" style="margin-top:16px">
        <label>Desvio ao objetivo (opcional)</label>
        <textarea id="psyDesvio" rows="2" placeholder="Motivos de eventual desvio (paragens, avarias, etc.)..." style="font-family:inherit;font-size:.95rem;padding:12px 14px;border:2px solid var(--color-border);border-radius:12px;resize:vertical;width:100%">${state.desvio_objetivo || ''}</textarea>
      </div>

      <div class="btn-row" style="margin-top:20px">
        <button type="button" class="btn btn-danger btn-big" id="psyResetBtn">🗑 Reset</button>
        <button type="button" class="btn btn-success btn-big" id="psySubmitBtn">✓ Submeter turno</button>
      </div>
    </div>

    <div class="card">
      <h2>📋 Registos recentes</h2>
      <div id="psyRecentList"><p class="sub">A carregar...</p></div>
    </div>
  `;

  // ==========================================================
  // Interactions — event delegation
  // ==========================================================
  const body = el.querySelector('#psyGrelhaBody');
  const saveInd = el.querySelector('#psyAutoSave');

  function flashSave() {
    saveInd.textContent = '💾 A gravar...'; saveInd.style.background = '#e3f2fd'; saveInd.style.color = '#0d47a1';
    setTimeout(() => { saveInd.textContent = '✓ Guardado'; saveInd.style.background = '#eef7ee'; saveInd.style.color = '#1f7a3a'; }, 400);
  }
  function persist() { saveState(userId, state); flashSave(); }

  function updateTotals() {
    let t = 0;
    for (const l of linhas) for (const e of (state.linhas[l.nome]?.entries || [])) t += Number(e.quantidade) || 0;
    el.querySelector('#psyTotQty').textContent = `${t} unid`;
  }

  function getCtx(target) {
    const row = target.closest('tr[data-linha]');
    if (!row) return null;
    const nome = row.dataset.linha;
    const idx = parseInt(row.dataset.eidx);
    const ls = state.linhas[nome];
    if (!ls?.entries?.[idx]) return null;
    return { nome, idx, entry: ls.entries[idx], ls };
  }

  function updateTargetCell(linhaNome, idx) {
    const row = body.querySelector(`tr[data-linha="${CSS.escape(linhaNome)}"][data-eidx="${idx}"]`);
    if (!row) return;
    const cells = row.children;
    // cells: [0]=name, [1]=prod, [2]=qty, [3]=target, [4]=remove
    if (cells.length < 4) return;
    const targetCell = cells[3];
    const e = state.linhas[linhaNome]?.entries?.[idx];
    if (!e) return;
    const target = targetFor(linhaNome, e.produto);
    const qty = Number(e.quantidade) || 0;
    const color = target && qty > 0 ? (qty / target >= 1 ? '#1f7a3a' : qty / target >= 0.7 ? '#ad8b00' : '#c0392b') : '#888';
    targetCell.style.color = color;
    targetCell.innerHTML = target ? `<div style="font-size:1.05rem;font-weight:600">🎯 ${target}</div>${qty > 0 ? `<div style="font-size:1.4rem;font-weight:800;line-height:1.1;margin-top:2px">${Math.round(qty / target * 100)}%</div>` : ''}` : '<span style="color:#ccc">—</span>';
  }

  body.addEventListener('input', (ev) => {
    const t = ev.target;
    const c = getCtx(t);
    if (!c) return;
    if (t.classList.contains('field-prod')) {
      c.entry.produto = t.value;
      persist();
      updateTargetCell(c.nome, c.idx);
    } else if (t.classList.contains('field-qty')) {
      c.entry.quantidade = Math.max(0, parseInt(t.value) || 0);
      persist(); updateTotals();
      updateTargetCell(c.nome, c.idx);
    }
  });

  body.addEventListener('change', (ev) => {
    const t = ev.target;
    const c = getCtx(t);
    if (!c) return;
    if (t.classList.contains('field-qty')) {
      t.value = c.entry.quantidade;
    }
  });

  body.addEventListener('click', (ev) => {
    const t = ev.target;
    const c = getCtx(t);
    if (c) {
      if (t.classList.contains('btn-inc')) {
        c.entry.quantidade = (Number(c.entry.quantidade) || 0) + 1;
        const qtyInp = t.closest('tr').querySelector('.field-qty');
        if (qtyInp) qtyInp.value = c.entry.quantidade;
        persist(); updateTotals(); updateTargetCell(c.nome, c.idx);
        return;
      }
      if (t.classList.contains('btn-dec')) {
        c.entry.quantidade = Math.max(0, (Number(c.entry.quantidade) || 0) - 1);
        const qtyInp = t.closest('tr').querySelector('.field-qty');
        if (qtyInp) qtyInp.value = c.entry.quantidade;
        persist(); updateTotals(); updateTargetCell(c.nome, c.idx);
        return;
      }
      if (t.classList.contains('btn-remove-entry')) {
        c.ls.entries.splice(c.idx, 1);
        persist(); renderPSY(el, ctx);  // estrutura mudou → OK perder foco
        return;
      }
    }
    const addRow = t.closest('tr[data-linha-add]');
    if (addRow && t.classList.contains('btn-add-entry')) {
      const nome = addRow.dataset.linhaAdd;
      state.linhas[nome].entries.push(emptyEntry());
      persist(); renderPSY(el, ctx);  // nova row inserida → OK perder foco
    }
  });

  el.querySelector('#psyDataReg').addEventListener('change', (e) => { state.data_registo = e.target.value || hoje; persist(); });
  el.querySelector('#psyTurnoSel').addEventListener('change', (e) => { state.turno = e.target.value; persist(); });
  el.querySelector('#psyDesvio').addEventListener('input', (e) => { state.desvio_objetivo = e.target.value; persist(); });

  el.querySelector('#psyResetBtn').addEventListener('click', () => {
    if (!confirm('Apagar todos os registos deste turno?')) return;
    clearState(userId); renderPSY(el, ctx);
  });

  el.querySelector('#psySubmitBtn').addEventListener('click', async () => {
    const dataReg = state.data_registo;
    const turno = state.turno;
    if (!dataReg) { toast('Indica a data do registo', 'error'); return; }

    const rows = [];
    const unknownProds = [];
    for (const l of linhas) {
      for (const e of (state.linhas[l.nome]?.entries || [])) {
        const q = Number(e.quantidade) || 0;
        const prod = (e.produto || '').trim();
        if (q <= 0 || !prod) continue;
        if (!produtoSet.has(prod)) { unknownProds.push(`${l.nome} → "${prod}"`); continue; }
        // Schema unificado: PSY escreve em movimentos com empresa='PSY'
        // malotes = quantidade (1 palete = 1 unidade), pecas_por_malote = 1, m3 = 0
        rows.push({
          tipo: 'entrada_producao', empresa: 'PSY',
          produto_stock: prod, malotes: q, pecas_por_malote: 1, m3: 0,
          data_registo: dataReg, linha: l.nome, turno,
          operador_id: ctx.profile.id, incerteza: false, duvida_resolvida: true,
          ...(state.desvio_objetivo?.trim() ? { desvio_objetivo: state.desvio_objetivo.trim() } : {}),
        });
      }
    }

    if (unknownProds.length) { toast(`Produtos desconhecidos: ${unknownProds.slice(0, 3).join('; ')}${unknownProds.length > 3 ? '...' : ''}`, 'error'); return; }
    if (rows.length === 0) { toast('Nada para submeter.', 'error'); return; }

    const totQty = rows.reduce((s, r) => s + r.malotes, 0);
    if (!confirm(`Submeter ${rows.length} registo(s) — ${totQty} unidades totais?`)) return;

    const btn = el.querySelector('#psySubmitBtn');
    btn.disabled = true; btn.textContent = 'A gravar...';
    let online = 0, offline = 0;
    for (const r of rows) {
      const res = await addMovimento(r);
      if (res.offline) offline++; else online++;
    }
    btn.disabled = false; btn.textContent = '✓ Submeter turno';

    toast(offline > 0 ? `✓ ${online} submetidos, ${offline} em fila offline` : `✓ ${online} registo(s) PSY gravados`, 'success');

    // Limpar qtds + desvio, manter produtos
    for (const l of linhas) for (const e of (state.linhas[l.nome]?.entries || [])) e.quantidade = 0;
    state.desvio_objetivo = '';
    persist(); renderPSY(el, ctx);
  });

  // Recent records (agora de movimentos com empresa='PSY')
  async function loadRecent() {
    const { data: recent } = await supabase
      .from('movimentos')
      .select('id, data_registo, linha, turno, produto_stock, malotes, criado_em, profiles!operador_id(nome)')
      .eq('empresa', 'PSY').eq('tipo', 'entrada_producao')
      .eq('estornado', false)
      .order('criado_em', { ascending: false })
      .limit(40);
    const list = el.querySelector('#psyRecentList');
    if (!recent?.length) { list.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Sem registos.</p>'; return; }
    const groups = new Map();
    for (const r of recent) {
      const key = `${r.data_registo}|${r.turno}|${r.criado_em.slice(0,16)}`;
      if (!groups.has(key)) groups.set(key, { ...r, items: [] });
      groups.get(key).items.push(r);
    }
    list.innerHTML = [...groups.values()].map(g => `
      <div style="padding:14px;border:1px solid #e0e0e0;border-radius:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <div style="font-weight:600">${g.data_registo} · ${g.turno || '—'}</div>
          <div style="font-size:.8rem;color:#6e6e73">${g.profiles?.nome || '—'} · ${new Date(g.criado_em).toLocaleString('pt-PT')}</div>
        </div>
        ${g.items.map(it => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #f0f0f3;gap:8px">
            <span style="color:#6e6e73;min-width:90px">${it.linha}</span>
            <span style="flex:1">${it.produto_stock}</span>
            <b style="color:var(--color-blue)">${it.malotes}</b>
          </div>
        `).join('')}
        <div style="display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #d2d2d7;margin-top:4px;font-weight:700">
          Total: ${g.items.reduce((s,it) => s + Number(it.malotes||0), 0)} unidades
        </div>
      </div>
    `).join('');
  }

  updateTotals();
  loadRecent();
}
