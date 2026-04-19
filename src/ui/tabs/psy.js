// Registos Produção PSY — grelha "turno-style" (similar ao MCF)
// - Data + Turno no topo
// - Uma linha por psy_linha; cada uma com produto (autocomplete) + stepper qtd
// - Auto-save em localStorage; submit envia uma entry por linha preenchida

import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

let linhasCache = null;
let produtosCache = null;

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

// ==========================================================
// Estado (localStorage por utilizador)
// ==========================================================
function storageKey(userId) { return `mcfpsy-psy-turno-${userId}`; }
function loadState(userId) { try { const r = localStorage.getItem(storageKey(userId)); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveState(userId, state) { try { localStorage.setItem(storageKey(userId), JSON.stringify(state)); } catch (e) { console.warn('saveState', e); } }
function clearState(userId) { localStorage.removeItem(storageKey(userId)); }

// ==========================================================
// Render
// ==========================================================
export async function renderPSY(el, ctx) {
  el.innerHTML = `<div class="card"><h2>🏭 Registos Produção PSY</h2><p class="sub">A carregar setup do turno...</p></div>`;
  const [linhas, produtos] = await Promise.all([loadLinhas(), loadProdutos()]);

  const userId = ctx.profile.id;
  const hoje = new Date().toISOString().slice(0, 10);
  let state = loadState(userId);

  // Reset diário: mantém turno mas limpa quantidades e produtos
  if (!state || state.data_registo !== hoje) {
    state = { data_registo: hoje, turno: state?.turno || 'T1', desvio_objetivo: '', linhas: {} };
    for (const l of linhas) state.linhas[l.nome] = { produto: '', quantidade: 0 };
    saveState(userId, state);
  }

  // Garantir que todas as linhas existem no state
  for (const l of linhas) {
    if (!state.linhas[l.nome]) state.linhas[l.nome] = { produto: '', quantidade: 0 };
  }

  const produtoSet = new Set(produtos);

  // ==========================================================
  // Build HTML
  // ==========================================================
  function rowHTML(linha) {
    const ls = state.linhas[linha.nome];
    const qty = ls.quantidade || 0;
    return `
      <tr data-linha="${linha.nome}">
        <td style="padding:10px;font-weight:600;white-space:nowrap">${linha.nome}</td>
        <td style="padding:8px">
          <input type="text" class="field-prod" list="psyProdList" value="${ls.produto || ''}" placeholder="Pesquisar tipo de palete..."
            style="width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem">
        </td>
        <td style="padding:8px">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px">
            <button type="button" class="btn-dec" style="width:44px;height:44px;border:2px solid var(--color-blue);background:#fff;color:var(--color-blue);border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">−</button>
            <input type="number" class="field-qty" min="0" step="1" value="${qty}" style="width:80px;padding:10px;border:2px solid var(--color-border);border-radius:10px;text-align:center;font-size:1.2rem;font-weight:700">
            <button type="button" class="btn-inc" style="width:44px;height:44px;border:2px solid var(--color-blue);background:var(--color-blue);color:#fff;border-radius:10px;font-size:1.4rem;font-weight:700;cursor:pointer;touch-action:manipulation">+</button>
          </div>
        </td>
      </tr>`;
  }

  el.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">🏭 Registos Produção PSY</h2>
        <span class="sync-pill" id="psyAutoSave" style="padding:4px 10px;background:#eef7ee;color:#1f7a3a;border-radius:999px;font-size:.75rem;font-weight:600">✓ Guardado</span>
      </div>
      <p class="sub">Escolhe o tipo de palete e quantidade para cada linha. Auto-save contínuo. Submete tudo no final.</p>

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
        <table id="psyGrelha" style="width:100%;border-collapse:collapse;min-width:600px;font-size:.9rem">
          <thead><tr style="background:#f5f5f7">
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0;width:120px">Linha</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Tipo de palete</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0;width:240px">Quantidade</th>
          </tr></thead>
          <tbody id="psyGrelhaBody">${linhas.map(rowHTML).join('')}</tbody>
          <tfoot><tr style="background:#f0f7ff;font-weight:700">
            <td colspan="2" style="padding:12px;border-top:2px solid var(--color-blue)">Total</td>
            <td style="padding:12px;text-align:center;border-top:2px solid var(--color-blue)" id="psyTotQty">0 unid</td>
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
  // Interactions
  // ==========================================================
  const body = el.querySelector('#psyGrelhaBody');
  const saveInd = el.querySelector('#psyAutoSave');

  function flashSave() {
    saveInd.textContent = '💾 A gravar...'; saveInd.style.background = '#e3f2fd'; saveInd.style.color = '#0d47a1';
    setTimeout(() => { saveInd.textContent = '✓ Guardado'; saveInd.style.background = '#eef7ee'; saveInd.style.color = '#1f7a3a'; }, 400);
  }
  function persist() { saveState(userId, state); flashSave(); }

  function updateTotals() {
    const t = linhas.reduce((s, l) => s + (Number(state.linhas[l.nome]?.quantidade) || 0), 0);
    el.querySelector('#psyTotQty').textContent = `${t} unid`;
  }

  body.querySelectorAll('tr[data-linha]').forEach(row => {
    const nome = row.dataset.linha;
    const ls = state.linhas[nome];
    const prodInp = row.querySelector('.field-prod');
    const qtyInp = row.querySelector('.field-qty');

    prodInp.addEventListener('input', () => { ls.produto = prodInp.value; persist(); });
    qtyInp.addEventListener('change', () => { ls.quantidade = Math.max(0, parseInt(qtyInp.value) || 0); qtyInp.value = ls.quantidade; persist(); updateTotals(); });

    row.querySelector('.btn-inc').addEventListener('click', () => { ls.quantidade = (Number(ls.quantidade) || 0) + 1; qtyInp.value = ls.quantidade; persist(); updateTotals(); });
    row.querySelector('.btn-dec').addEventListener('click', () => { ls.quantidade = Math.max(0, (Number(ls.quantidade) || 0) - 1); qtyInp.value = ls.quantidade; persist(); updateTotals(); });
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
      const ls = state.linhas[l.nome];
      const q = Number(ls.quantidade) || 0;
      const prod = (ls.produto || '').trim();
      if (q <= 0 || !prod) continue;
      if (!produtoSet.has(prod)) { unknownProds.push(`${l.nome} → "${prod}"`); continue; }
      rows.push({
        data_registo: dataReg,
        linha: l.nome,
        turno,
        produto: prod,
        quantidade: q,
        operador_id: ctx.profile.id,
        ...(state.desvio_objetivo?.trim() ? { desvio_objetivo: state.desvio_objetivo.trim() } : {}),
      });
    }

    if (unknownProds.length) { toast(`Produtos desconhecidos: ${unknownProds.join('; ')}`, 'error'); return; }
    if (rows.length === 0) { toast('Nada para submeter. Indica produto + quantidade em pelo menos uma linha.', 'error'); return; }

    const totQty = rows.reduce((s, r) => s + r.quantidade, 0);
    if (!confirm(`Submeter ${rows.length} registo(s) — ${totQty} unidades totais?`)) return;

    const btn = el.querySelector('#psySubmitBtn');
    btn.disabled = true; btn.textContent = 'A gravar...';
    const { error } = await supabase.from('psy_producao').insert(rows);
    btn.disabled = false; btn.textContent = '✓ Submeter turno';

    if (error) { toast('Erro: ' + error.message, 'error'); return; }

    toast(`✓ ${rows.length} registo(s) PSY gravados`, 'success');

    // Limpar quantidades + desvio, manter setup (produto) como no MCF
    for (const l of linhas) state.linhas[l.nome].quantidade = 0;
    state.desvio_objetivo = '';
    persist();
    renderPSY(el, ctx);
  });

  // Recent records (igual ao anterior, agrupa por data/linha/turno)
  async function loadRecent() {
    const { data: recent } = await supabase
      .from('psy_producao')
      .select('*, profiles!operador_id(nome)')
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
          <div style="font-weight:600">${g.data_registo} · ${g.turno}</div>
          <div style="font-size:.8rem;color:#6e6e73">${g.profiles?.nome || '—'} · ${new Date(g.criado_em).toLocaleString('pt-PT')}</div>
        </div>
        ${g.items.map(it => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #f0f0f3;gap:8px">
            <span style="color:#6e6e73;min-width:90px">${it.linha}</span>
            <span style="flex:1">${it.produto}</span>
            <b style="color:var(--color-blue)">${it.quantidade}</b>
          </div>
        `).join('')}
        <div style="display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #d2d2d7;margin-top:4px;font-weight:700">
          Total: ${g.items.reduce((s,it) => s + it.quantidade, 0)} unidades
        </div>
      </div>
    `).join('');
  }

  updateTotals();
  loadRecent();
}
