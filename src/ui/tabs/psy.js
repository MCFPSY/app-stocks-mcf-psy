import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

let linhasCache = null;
let produtosCache = null;

async function loadLinhas() {
  if (linhasCache) return linhasCache;
  const { data } = await supabase.from('psy_linhas').select('*').eq('ativo', true).order('nome');
  linhasCache = data || [];
  return linhasCache;
}

async function loadProdutos() {
  if (produtosCache) return produtosCache;
  const { data } = await supabase.from('psy_produtos').select('*').eq('ativo', true).order('nome');
  produtosCache = data || [];
  return produtosCache;
}

export async function renderPSY(el, ctx) {
  el.innerHTML = `<div class="card"><h2>🏭 Registos Produção PSY</h2><p class="sub">A carregar...</p></div>`;
  const [linhas, produtos] = await Promise.all([loadLinhas(), loadProdutos()]);

  // Items to submit (the "cart")
  const items = [];

  el.innerHTML = `
    <div class="card">
      <h2>🏭 Registos Produção PSY</h2>
      <p class="sub">Registo de produção de paletes — define data, linha e turno, depois adiciona vários modelos de paletes e quantidades. Submete tudo no final.</p>
      <div class="form-grid" style="margin-bottom:20px">
        <div class="field">
          <label>Data do registo</label>
          <input class="big" id="dataRegisto" type="date" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="field">
          <label>Turno</label>
          <select class="big" id="turno">
            <option value="T1">T1</option>
            <option value="T2">T2</option>
          </select>
        </div>
      </div>

      <div style="border:2px dashed var(--color-border);border-radius:14px;padding:18px;margin-bottom:20px">
        <h3 style="font-size:1rem;margin-bottom:14px">➕ Adicionar palete</h3>
        <div class="form-grid">
          <div class="field">
            <label>Linha de produção</label>
            <select id="linha" style="width:100%;padding:14px 16px;border:2px solid var(--color-border);border-radius:12px;font-size:1rem;background:#fff;min-height:54px">
              ${linhas.map(l => `<option value="${l.nome}">${l.nome}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Tipo de palete</label>
            <input type="text" id="prodSearch" placeholder="Pesquisar palete..." style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem;margin-bottom:6px">
            <select id="produto" size="6" style="width:100%;min-height:140px;padding:8px;border:2px solid var(--color-border);border-radius:12px;font-size:.9rem">
              ${produtos.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('')}
            </select>
            <span class="hint" id="prodCount">${produtos.length} tipos disponíveis</span>
          </div>
          <div style="display:flex;gap:12px;grid-column:1/-1">
            <div class="field" style="flex:1">
              <label>Quantidade (unidades)</label>
              <input class="big" id="qty" type="number" min="1" step="1" inputmode="numeric" placeholder="Nº paletes">
            </div>
            <div class="field" style="flex:1;display:flex;flex-direction:column">
              <label>&nbsp;</label>
              <button type="button" class="btn btn-primary" id="addBtn" style="flex:1;justify-content:center;font-size:1.15rem;font-weight:600;border-radius:12px">+ Adicionar à lista</button>
            </div>
          </div>
        </div>
      </div>

      <div id="cartSection" style="display:none">
        <h3 style="font-size:1rem;margin-bottom:10px">📦 Paletes a registar</h3>
        <div id="cartList"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:14px;background:#f0f7ff;border-radius:12px">
          <div><b id="cartTotal">0</b> modelo(s) · <b id="cartQtyTotal">0</b> unidades total</div>
        </div>

        <div class="btn-row" style="margin-top:16px">
          <button type="button" class="btn btn-secondary btn-big" id="clearAllBtn">Limpar tudo</button>
          <button type="button" class="btn btn-success btn-big" id="submitAllBtn">✓ Registar tudo</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>📋 Registos recentes</h2>
      <div id="recentList"><p class="sub">A carregar...</p></div>
    </div>
  `;

  const $ = id => el.querySelector('#'+id);
  const prodSelect = $('produto');
  const prodSearch = $('prodSearch');
  const prodCount = $('prodCount');

  // Search filter for pallet types
  prodSearch.addEventListener('input', () => {
    const q = prodSearch.value.trim().toLowerCase();
    let visible = 0;
    for (const opt of prodSelect.options) {
      const match = !q || opt.value.toLowerCase().includes(q);
      opt.style.display = match ? '' : 'none';
      if (match) visible++;
    }
    prodCount.textContent = `${visible} de ${produtos.length} tipos`;
    if (q) {
      for (const opt of prodSelect.options) {
        if (opt.style.display !== 'none') { opt.selected = true; break; }
      }
    }
  });

  function renderCart() {
    const section = $('cartSection');
    const list = $('cartList');
    if (!items.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    list.innerHTML = items.map((it, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid var(--color-border);border-radius:10px;margin-bottom:8px;gap:10px">
        <div style="flex:1">
          <div style="font-weight:600">${it.produto}</div>
          <div style="font-size:.8rem;color:#6e6e73">${it.linha}</div>
        </div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--color-blue);min-width:60px;text-align:right">${it.quantidade}</div>
        <button type="button" class="btn btn-danger" data-rm="${i}" style="padding:8px 12px;font-size:.85rem">✕</button>
      </div>
    `).join('');
    $('cartTotal').textContent = items.length;
    $('cartQtyTotal').textContent = items.reduce((s, it) => s + it.quantidade, 0);

    // Remove buttons
    list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      items.splice(parseInt(b.dataset.rm), 1);
      renderCart();
    });
  }

  // Add to cart
  $('addBtn').addEventListener('click', () => {
    const produto = prodSelect.value;
    const qty = parseInt($('qty').value);
    if (!produto) return toast('Seleciona um tipo de palete', 'error');
    if (!qty || qty <= 0) return toast('Indica a quantidade', 'error');

    const linha = $('linha').value;

    // Check if same product+line already in cart — merge quantities
    const existing = items.find(it => it.produto === produto && it.linha === linha);
    if (existing) {
      existing.quantidade += qty;
    } else {
      items.push({ produto, quantidade: qty, linha });
    }

    $('qty').value = '';
    prodSearch.value = '';
    prodSearch.dispatchEvent(new Event('input'));
    renderCart();
    toast(`${produto} adicionado`, 'success');
  });

  // Clear all
  $('clearAllBtn').addEventListener('click', () => {
    items.length = 0;
    renderCart();
  });

  // Submit all
  $('submitAllBtn').addEventListener('click', async () => {
    if (!items.length) return toast('Adiciona pelo menos um modelo', 'error');
    const dataReg = $('dataRegisto').value;
    const turno = $('turno').value;

    if (!dataReg) return toast('Indica a data do registo', 'error');

    const totalQty = items.reduce((s, it) => s + it.quantidade, 0);

    const ok = await showSummary({
      Data: dataReg,
      Turno: turno,
      'Modelos': `${items.length} tipo(s)`,
      'Total unidades': totalQty,
    }, items);
    if (!ok) return;

    const btn = $('submitAllBtn');
    btn.disabled = true; btn.textContent = 'A gravar...';

    const rows = items.map(it => ({
      data_registo: dataReg,
      linha: it.linha,
      turno,
      produto: it.produto,
      quantidade: it.quantidade,
      operador_id: ctx.profile.id,
    }));

    const { error } = await supabase.from('psy_producao').insert(rows);
    btn.disabled = false; btn.textContent = '✓ Registar tudo';

    if (error) return toast('Erro: ' + error.message, 'error');

    toast(`✓ ${items.length} registo(s) PSY gravados`, 'success');
    items.length = 0;
    renderCart();
    loadRecent();
  });

  // Recent records
  async function loadRecent() {
    const { data: recent } = await supabase
      .from('psy_producao')
      .select('*, profiles!operador_id(nome)')
      .order('criado_em', { ascending: false })
      .limit(20);

    const list = $('recentList');
    if (!recent?.length) {
      list.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Sem registos.</p>';
      return;
    }

    // Group by (data_registo, linha, turno, criado_em rounded to minute)
    const groups = new Map();
    for (const r of recent) {
      const key = `${r.data_registo}|${r.linha}|${r.turno}|${r.criado_em.slice(0,16)}`;
      if (!groups.has(key)) groups.set(key, { ...r, items: [] });
      groups.get(key).items.push(r);
    }

    list.innerHTML = [...groups.values()].map(g => `
      <div style="padding:14px;border:1px solid #e0e0e0;border-radius:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <div style="font-weight:600">${g.linha} · ${g.turno} · ${g.data_registo}</div>
          <div style="font-size:.8rem;color:#6e6e73">${g.profiles?.nome || '—'} · ${new Date(g.criado_em).toLocaleString('pt-PT')}</div>
        </div>
        ${g.items.map(it => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #f0f0f3;gap:8px">
            <span style="color:#6e6e73;min-width:70px">${it.linha}</span>
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

  loadRecent();
}

function showSummary(obj, items) {
  return new Promise(resolve => {
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.innerHTML = `
      <div class="modal" style="max-width:600px;max-height:80vh;overflow-y:auto">
        <h3>📋 Confirmar operação</h3>
        ${Object.entries(obj).map(([k,v]) => `<div class="summary-row"><span>${k}</span><b>${v}</b></div>`).join('')}
        ${items ? `
          <div style="margin-top:14px;border-top:1px solid #e0e0e0;padding-top:14px">
            <div style="font-weight:600;margin-bottom:8px">Detalhe:</div>
            ${items.map(it => `<div class="summary-row"><span>${it.linha} · ${it.produto}</span><b>${it.quantidade}</b></div>`).join('')}
          </div>
        ` : ''}
        <div class="btn-row">
          <button class="btn btn-secondary" id="cancelBtn">Cancelar</button>
          <button class="btn btn-success" id="okBtn">✓ Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    div.querySelector('#cancelBtn').onclick = () => { div.remove(); resolve(false); };
    div.querySelector('#okBtn').onclick = () => { div.remove(); resolve(true); };
  });
}
