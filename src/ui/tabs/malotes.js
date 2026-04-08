import { supabase } from '../../supabase.js';
import { toast } from '../app.js';
import { addMovimento, cachePut, cacheGet } from '../../offline.js';

let mpCache = null;

async function loadMP() {
  if (mpCache) return mpCache;
  if (navigator.onLine) {
    const { data, error } = await supabase.from('mp_standard').select('*').eq('ativo', true).order('produto_stock');
    if (!error && data) { mpCache = data; await cachePut('mp_standard', data); return data; }
  }
  // offline fallback
  const cached = await cacheGet('mp_standard');
  if (cached) { mpCache = cached; return cached; }
  toast('Sem produtos em cache — liga à internet uma vez para os descarregar','error');
  return [];
}

export async function renderMalotes(el, ctx) {
  el.innerHTML = `<div class="card"><h2>📦 Inserir Malotes de Produção MCF</h2><p class="sub">A carregar produtos...</p></div>`;
  const mp = await loadMP();

  // produtos únicos por (categoria, produto_conversao || produto_stock)
  const cats = [...new Set(mp.map(x => x.categoria))];
  const defaultCat = cats.includes('tabuas') ? 'tabuas' : cats[0];

  el.innerHTML = `
    <div class="card">
      <h2>📦 Inserir Malotes de Produção MCF</h2>
      <p class="sub">Empilhadorista — escolhe produto, nº malotes e peças por malote. Total e m³ são automáticos.</p>
      <form id="fMal">
        <div class="form-grid">
          <div class="field">
            <label>Categoria</label>
            <select class="big" id="cat">${cats.map(c=>`<option ${c===defaultCat?'selected':''}>${c}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Produto registado</label>
            <select class="big" id="prod"></select>
          </div>
          <div class="field">
            <label>Produto stock (auto)</label>
            <input class="big readonly" id="prodStock" readonly>
            <span class="hint" id="convHint"></span>
          </div>
          <div class="field">
            <label>Nº de malotes</label>
            <input class="big" id="nMal" type="number" min="0" step="0.01" inputmode="decimal">
          </div>
          <div class="field">
            <label>Peças por malote (auto)</label>
            <input class="big readonly" id="nPec" readonly>
          </div>
          <div class="field">
            <label>Total peças (auto)</label>
            <input class="big readonly" id="totPec" readonly>
          </div>
          <div class="field">
            <label>m³ totais (auto)</label>
            <input class="big readonly" id="m3" readonly>
          </div>
          <div class="field">
            <label>Incerteza no produto?</label>
            <select class="big" id="incerteza"><option value="false">Não</option><option value="true">Sim — enviar para Dúvidas</option></select>
          </div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary btn-big" id="clearBtn">Limpar</button>
          <button type="submit" class="btn btn-primary btn-big" id="subBtn">✓ Registar entrada</button>
        </div>
      </form>
    </div>
  `;

  const $ = id => el.querySelector('#'+id);
  const catSel = $('cat'), prodSel = $('prod'), prodStock = $('prodStock'), convHint = $('convHint');
  const nMal = $('nMal'), nPec = $('nPec'), totPec = $('totPec'), m3Field = $('m3');

  function fillProducts() {
    const cat = catSel.value;
    const items = mp.filter(x => x.categoria === cat);
    const seen = new Set();
    const opts = [];
    for (const it of items) {
      const key = it.produto_conversao || it.produto_stock;
      if (seen.has(key)) continue; seen.add(key);
      opts.push(`<option value="${it.id}">${key}</option>`);
    }
    prodSel.innerHTML = opts.join('');
    onProdChange();
  }
  function current() {
    const id = prodSel.value;
    return mp.find(x => x.id === id);
  }
  function onProdChange() {
    const p = current();
    if (!p) return;
    prodStock.value = p.produto_stock;
    nPec.value = p.pecas_por_malote;
    convHint.textContent = (p.produto_conversao && p.produto_conversao !== p.produto_stock)
      ? `↑ Convertido de "${p.produto_conversao}" para "${p.produto_stock}"` : '';
    recalc();
  }
  function recalc() {
    const p = current(); if (!p) return;
    const nm = parseFloat(nMal.value) || 0;
    const np = p.pecas_por_malote;
    const tot = nm * np;
    totPec.value = tot;
    // m3 de uma peça: C × L × E (mm) → m3
    const vol1 = (p.comprimento/1000) * (p.largura/1000) * (p.espessura/1000);
    m3Field.value = (vol1 * tot).toFixed(4) + ' m³';
  }
  catSel.addEventListener('change', fillProducts);
  prodSel.addEventListener('change', onProdChange);
  nMal.addEventListener('input', recalc);
  el.querySelector('#clearBtn').addEventListener('click', () => { nMal.value=''; recalc(); });

  el.querySelector('#fMal').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = current(); if (!p) return;
    const nm = parseFloat(nMal.value);
    if (!nm || nm <= 0) { toast('Indica o número de malotes','error'); return; }
    const tot = nm * p.pecas_por_malote;
    const vol1 = (p.comprimento/1000) * (p.largura/1000) * (p.espessura/1000);
    const m3v = +(vol1 * tot).toFixed(4);
    const inc = $('incerteza').value === 'true';

    const ok = await showSummary({
      Empresa: 'MCF',
      Produto: p.produto_stock,
      'Malotes × peças': `${nm} × ${p.pecas_por_malote} = ${tot}`,
      Volume: m3v + ' m³',
      Incerteza: inc ? 'Sim (vai para Dúvidas)' : 'Não',
    });
    if (!ok) return;

    const subBtn = $('subBtn'); subBtn.disabled = true; subBtn.textContent = 'A gravar...';
    const res = await addMovimento({
      tipo: 'entrada_producao',
      empresa: 'MCF',
      produto_stock: p.produto_stock,
      malotes: nm,
      pecas_por_malote: p.pecas_por_malote,
      m3: m3v,
      operador_id: ctx.profile.id,
      incerteza: inc,
      duvida_resolvida: !inc,
    });
    subBtn.disabled = false; subBtn.textContent = '✓ Registar entrada';
    toast(res.offline ? '📤 Guardado offline — sincroniza quando houver rede' : '✓ Entrada registada','success');
    nMal.value=''; recalc();
    window.dispatchEvent(new CustomEvent('sync-done'));
  });

  fillProducts();
}

function showSummary(obj) {
  return new Promise(resolve => {
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.innerHTML = `
      <div class="modal">
        <h3>📋 Confirmar operação</h3>
        ${Object.entries(obj).map(([k,v])=>`<div class="summary-row"><span>${k}</span><b>${v}</b></div>`).join('')}
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
