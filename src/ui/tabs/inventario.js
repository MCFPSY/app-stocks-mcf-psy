import { supabase } from '../../supabase.js';

let currentMode = 'madeira';

export async function renderInventario(el, ctx) {
  el.innerHTML = `
    <div class="card">
      <h2>📊 Inventário Permanente</h2>
      <div style="display:flex;gap:6px;background:#f5f5f7;padding:6px;border-radius:14px;margin-bottom:20px">
        <button class="tab-btn inv-mode active" data-mode="madeira" style="flex:1;padding:12px;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer">🪵 Madeira serrada</button>
        <button class="tab-btn inv-mode" data-mode="paletes" style="flex:1;padding:12px;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;background:transparent;color:var(--color-text-2)">📦 Paletes</button>
        <button class="tab-btn inv-mode" data-mode="rolaria" style="flex:1;padding:12px;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;background:transparent;color:var(--color-text-2)">🪵 Rolaria</button>
      </div>
      <div id="invContent"><p class="sub">A carregar...</p></div>
    </div>
  `;

  const modeButtons = el.querySelectorAll('.inv-mode');
  modeButtons.forEach(btn => btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    modeButtons.forEach(b => {
      b.classList.toggle('active', b === btn);
      if (b === btn) { b.style.background = ''; b.style.color = ''; }
      else { b.style.background = 'transparent'; b.style.color = 'var(--color-text-2)'; }
    });
    loadContent();
  }));

  const content = el.querySelector('#invContent');

  async function loadContent() {
    content.innerHTML = '<p class="sub">A carregar...</p>';
    if (currentMode === 'madeira') await renderMadeira(content);
    else if (currentMode === 'paletes') await renderPaletes(content);
    else await renderRolaria(content);
  }

  loadContent();
}

// ====== MADEIRA SERRADA (existing logic) ======
async function renderMadeira(el) {
  const [stockRes, mpRes] = await Promise.all([
    supabase.from('v_stock').select('*').order('produto_stock'),
    supabase.from('mp_standard').select('produto_stock, categoria').eq('ativo', true),
  ]);
  if (stockRes.error) { el.innerHTML = `<p class="sub">Erro: ${stockRes.error.message}</p>`; return; }
  const data = stockRes.data;
  // Build produto -> categoria lookup
  const catMap = new Map();
  for (const p of (mpRes.data || [])) {
    if (!catMap.has(p.produto_stock)) catMap.set(p.produto_stock, p.categoria);
  }

  const map = new Map();
  for (const r of data) {
    const cat = catMap.get(r.produto_stock) || 'outros';
    if (cat === 'rolaria') continue; // rolaria tem o seu próprio modo
    if (!map.has(r.produto_stock)) map.set(r.produto_stock, { produto: r.produto_stock, MCF: 0, PSY: 0, m3: 0, categoria: cat });
    const o = map.get(r.produto_stock);
    o[r.empresa] = Number(r.malotes || 0);
    o.m3 += Number(r.m3 || 0);
  }
  const allRows = [...map.values()];
  const totalMal = allRows.reduce((s, r) => s + (r.MCF || 0) + (r.PSY || 0), 0);
  const totalM3 = allRows.reduce((s, r) => s + (r.m3 || 0), 0);

  el.innerHTML = `
    <p class="sub">Stock de madeira serrada calculado a partir dos movimentos.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
      <div class="card" style="margin:0"><div class="sub">Produtos distintos</div><div style="font-size:1.85rem;font-weight:700" id="statProdutos">${allRows.length}</div></div>
      <div class="card" style="margin:0"><div class="sub">Total malotes</div><div style="font-size:1.85rem;font-weight:700" id="statMalotes">${totalMal.toFixed(0)}</div></div>
      <div class="card" style="margin:0"><div class="sub">Total m³</div><div style="font-size:1.85rem;font-weight:700" id="statM3">${totalM3.toFixed(2)}</div></div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:200px">
        <label>Pesquisar produto</label>
        <input type="text" id="searchProd" placeholder="Ex: 2500x90" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
      </div>
      <div class="field" style="min-width:150px">
        <label>Empresa</label>
        <select id="filterEmpresa" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
          <option value="all">Ambos</option>
          <option value="MCF">MCF</option>
          <option value="PSY">PSY</option>
        </select>
      </div>
      <div class="field" style="min-width:180px">
        <label>Categoria</label>
        <select id="filterCategoria" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
          <option value="all">Todos</option>
          <option value="tabuas">Tábuas</option>
          <option value="barrotes">Barrotes</option>
          <option value="outros">Outros</option>
        </select>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding:12px;border-bottom:2px solid #e0e0e0">Produto</th>
        <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0" id="colMCF">MCF</th>
        <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0" id="colPSY">PSY</th>
        <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0">m³</th>
      </tr></thead>
      <tbody id="invBody"></tbody>
    </table>
  `;

  const searchInput = el.querySelector('#searchProd');
  const filterEmpresa = el.querySelector('#filterEmpresa');
  const filterCategoria = el.querySelector('#filterCategoria');
  const tbody = el.querySelector('#invBody');
  const colMCF = el.querySelector('#colMCF');
  const colPSY = el.querySelector('#colPSY');
  const statProdutos = el.querySelector('#statProdutos');
  const statMalotes = el.querySelector('#statMalotes');
  const statM3 = el.querySelector('#statM3');

  function renderTable() {
    const query = searchInput.value.trim().toLowerCase();
    const emp = filterEmpresa.value;
    const cat = filterCategoria.value;
    const filtered = allRows.filter(r => {
      if (query && !r.produto.toLowerCase().includes(query)) return false;
      if (emp === 'MCF' && !r.MCF) return false;
      if (emp === 'PSY' && !r.PSY) return false;
      if (cat !== 'all' && r.categoria !== cat) return false;
      return true;
    });
    const fMal = filtered.reduce((s, r) => {
      if (emp === 'MCF') return s + (r.MCF || 0);
      if (emp === 'PSY') return s + (r.PSY || 0);
      return s + (r.MCF || 0) + (r.PSY || 0);
    }, 0);
    const fM3 = filtered.reduce((s, r) => s + (r.m3 || 0), 0);
    statProdutos.textContent = filtered.length;
    statMalotes.textContent = fMal.toFixed(0);
    statM3.textContent = fM3.toFixed(2);
    colMCF.style.display = emp === 'PSY' ? 'none' : '';
    colPSY.style.display = emp === 'MCF' ? 'none' : '';

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:#888">Sem resultados</td></tr>';
      return;
    }
    const subMCF = filtered.reduce((s, r) => s + (r.MCF || 0), 0);
    const subPSY = filtered.reduce((s, r) => s + (r.PSY || 0), 0);
    const subM3 = filtered.reduce((s, r) => s + (r.m3 || 0), 0);

    tbody.innerHTML = filtered.map(r => `<tr>
      <td style="padding:12px;border-bottom:1px solid #f0f0f3">${r.produto}</td>
      <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3${emp === 'PSY' ? ';display:none' : ''}">${r.MCF.toFixed(0)}</td>
      <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3${emp === 'MCF' ? ';display:none' : ''}">${r.PSY.toFixed(0)}</td>
      <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3">${r.m3.toFixed(3)}</td>
    </tr>`).join('') + `<tr style="background:#f0f7ff;font-weight:700">
      <td style="padding:12px;border-top:2px solid var(--color-blue)">Subtotal (${filtered.length} produtos)</td>
      <td style="padding:12px;text-align:right;border-top:2px solid var(--color-blue)${emp === 'PSY' ? ';display:none' : ''}">${subMCF.toFixed(0)}</td>
      <td style="padding:12px;text-align:right;border-top:2px solid var(--color-blue)${emp === 'MCF' ? ';display:none' : ''}">${subPSY.toFixed(0)}</td>
      <td style="padding:12px;text-align:right;border-top:2px solid var(--color-blue)">${subM3.toFixed(3)} m³</td>
    </tr>`;
  }

  searchInput.addEventListener('input', renderTable);
  filterEmpresa.addEventListener('change', renderTable);
  filterCategoria.addEventListener('change', renderTable);
  renderTable();
}

// ====== ROLARIA (MCF, em toneladas) ======
async function renderRolaria(el) {
  const [stockRes, gamasRes] = await Promise.all([
    supabase.from('v_stock').select('produto_stock, malotes').eq('empresa', 'MCF'),
    supabase.from('rolaria_gamas').select('nome, comp_rolaria_mm, diam_min_mm, diam_max_mm').eq('ativo', true),
  ]);
  if (stockRes.error) { el.innerHTML = `<p class="sub">Erro: ${stockRes.error.message}</p>`; return; }
  const stockMap = new Map();
  for (const r of (stockRes.data || [])) {
    if (!r.produto_stock || !r.produto_stock.startsWith('Rolaria ')) continue;
    stockMap.set(r.produto_stock, Number(r.malotes || 0));
  }
  const gamas = (gamasRes.data || []).map(g => ({
    produto: 'Rolaria ' + g.nome,
    comp: g.comp_rolaria_mm,
    diamMin: g.diam_min_mm,
    diamMax: g.diam_max_mm,
    tons: stockMap.get('Rolaria ' + g.nome) || 0,
  })).sort((a, b) => a.comp - b.comp || a.diamMin - b.diamMin);

  const totalTons = gamas.reduce((s, r) => s + r.tons, 0);
  const negCount = gamas.filter(r => r.tons < 0).length;

  el.innerHTML = `
    <p class="sub">Stock de rolaria em MCF (toneladas). Consumos vêm dos registos de produção via algoritmo gama. Entradas (compras) virão do Primavera — por agora o stock fica negativo.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
      <div class="card" style="margin:0"><div class="sub">Gamas</div><div style="font-size:1.85rem;font-weight:700">${gamas.length}</div></div>
      <div class="card" style="margin:0"><div class="sub">Total (ton)</div><div style="font-size:1.85rem;font-weight:700;color:${totalTons < 0 ? '#c0392b' : 'inherit'}">${totalTons.toFixed(2)}</div></div>
      <div class="card" style="margin:0"><div class="sub">Gamas negativas</div><div style="font-size:1.85rem;font-weight:700;color:${negCount > 0 ? '#c0392b' : 'inherit'}">${negCount}</div></div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding:12px;border-bottom:2px solid #e0e0e0">Comp (mm)</th>
        <th style="text-align:left;padding:12px;border-bottom:2px solid #e0e0e0">Diâmetro (mm)</th>
        <th style="text-align:left;padding:12px;border-bottom:2px solid #e0e0e0">Gama</th>
        <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0">Stock (ton)</th>
      </tr></thead>
      <tbody>
        ${gamas.length === 0 ? '<tr><td colspan="4" style="padding:20px;text-align:center;color:#888">Sem gamas configuradas</td></tr>'
          : gamas.map(r => `<tr>
            <td style="padding:12px;border-bottom:1px solid #f0f0f3">${r.comp}</td>
            <td style="padding:12px;border-bottom:1px solid #f0f0f3">${r.diamMin}–${r.diamMax >= 9999 ? '∞' : r.diamMax}</td>
            <td style="padding:12px;border-bottom:1px solid #f0f0f3;font-size:.85rem;color:#666">${r.produto}</td>
            <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3;font-weight:600;color:${r.tons < 0 ? '#c0392b' : 'inherit'}">${r.tons.toFixed(2)}</td>
          </tr>`).join('')}
      </tbody>
      ${gamas.length ? `<tfoot><tr style="background:#f0f7ff;font-weight:700">
        <td colspan="3" style="padding:12px;border-top:2px solid var(--color-blue)">Total</td>
        <td style="padding:12px;text-align:right;border-top:2px solid var(--color-blue);color:${totalTons < 0 ? '#c0392b' : 'inherit'}">${totalTons.toFixed(2)} ton</td>
      </tr></tfoot>` : ''}
    </table>
  `;
}

// ====== PALETES (PSY stock via v_stock — inclui produção + transferências) ======
async function renderPaletes(el) {
  const { data, error } = await supabase
    .from('v_stock')
    .select('produto_stock, malotes')
    .eq('empresa', 'PSY')
    .gt('malotes', 0);

  if (error) { el.innerHTML = `<p class="sub">Erro: ${error.message}</p>`; return; }

  // Map para manter shape consistente com resto do código
  const map = new Map();
  for (const r of (data || [])) {
    const produto = r.produto_stock;
    if (!produto) continue;
    map.set(produto, { produto, quantidade: Number(r.malotes || 0) });
  }
  const allRows = [...map.values()].sort((a, b) => a.produto.localeCompare(b.produto));
  const totalQty = allRows.reduce((s, r) => s + r.quantidade, 0);

  el.innerHTML = `
    <p class="sub">Stock de paletes calculado a partir dos registos de produção PSY.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
      <div class="card" style="margin:0"><div class="sub">Modelos distintos</div><div style="font-size:1.85rem;font-weight:700" id="pStatProdutos">${allRows.length}</div></div>
      <div class="card" style="margin:0"><div class="sub">Total unidades</div><div style="font-size:1.85rem;font-weight:700" id="pStatQty">${totalQty.toLocaleString('pt-PT')}</div></div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:200px">
        <label>Pesquisar palete</label>
        <input type="text" id="pSearchProd" placeholder="Ex: 1000X1200" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding:12px;border-bottom:2px solid #e0e0e0">Palete</th>
        <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0">Quantidade</th>
      </tr></thead>
      <tbody id="pInvBody"></tbody>
    </table>
  `;

  const searchInput = el.querySelector('#pSearchProd');
  const tbody = el.querySelector('#pInvBody');
  const statProdutos = el.querySelector('#pStatProdutos');
  const statQty = el.querySelector('#pStatQty');

  function renderTable() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = allRows.filter(r => !query || r.produto.toLowerCase().includes(query));

    const fQty = filtered.reduce((s, r) => s + r.quantidade, 0);
    statProdutos.textContent = filtered.length;
    statQty.textContent = fQty.toLocaleString('pt-PT');

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="2" style="padding:20px;text-align:center;color:#888">Sem resultados</td></tr>';
      return;
    }

    const subQty = filtered.reduce((s, r) => s + r.quantidade, 0);
    tbody.innerHTML = filtered.map(r => `<tr>
      <td style="padding:12px;border-bottom:1px solid #f0f0f3">${r.produto}</td>
      <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3;font-weight:600">${r.quantidade.toLocaleString('pt-PT')}</td>
    </tr>`).join('') + `<tr style="background:#f0f7ff;font-weight:700">
      <td style="padding:12px;border-top:2px solid var(--color-blue)">Subtotal (${filtered.length} modelos)</td>
      <td style="padding:12px;text-align:right;border-top:2px solid var(--color-blue)">${subQty.toLocaleString('pt-PT')} unidades</td>
    </tr>`;
  }

  searchInput.addEventListener('input', renderTable);
  renderTable();
}
