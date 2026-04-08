import { supabase } from '../../supabase.js';
import { toast } from '../app.js';
import { addMovimento, cachePut, cacheGet } from '../../offline.js';

let mpCache = null;
async function loadMP() {
  if (mpCache) return mpCache;
  if (navigator.onLine) {
    const { data } = await supabase.from('mp_standard').select('*').eq('ativo', true).order('produto_stock');
    if (data) { mpCache = data; await cachePut('mp_standard', data); return data; }
  }
  mpCache = (await cacheGet('mp_standard')) || [];
  return mpCache;
}

async function getStockMCF(produto_stock) {
  const { data } = await supabase.from('v_stock').select('malotes').eq('produto_stock', produto_stock).eq('empresa','MCF').maybeSingle();
  return Number(data?.malotes || 0);
}

export async function renderTransfer(el, ctx) {
  el.innerHTML = `<div class="card"><h2>🔄 Transferência MCF → PSY</h2><p class="sub">A carregar...</p></div>`;
  const mp = await loadMP();
  const cats = [...new Set(mp.map(x => x.categoria))];
  const defaultCat = cats.includes('tabuas') ? 'tabuas' : cats[0];

  el.innerHTML = `
    <div class="card">
      <h2>🔄 Transferência MCF → PSY</h2>
      <p class="sub">Sai da MCF, entra na PSY. Um único movimento, aplicado às duas empresas.</p>
      <form id="fT">
        <div class="form-grid">
          <div class="field"><label>Categoria</label>
            <select class="big" id="cat">${cats.map(c=>`<option ${c===defaultCat?'selected':''}>${c}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Produto</label><select class="big" id="prod"></select></div>
          <div class="field"><label>Produto stock (auto)</label><input class="big readonly" id="prodStock" readonly></div>
          <div class="field"><label>Stock atual MCF</label><input class="big readonly" id="stockMCF" readonly></div>
          <div class="field"><label>Nº malotes a transferir</label><input class="big" id="nMal" type="number" min="0" step="0.01" inputmode="decimal"></div>
          <div class="field"><label>Peças/malote (auto)</label><input class="big readonly" id="nPec" readonly></div>
          <div class="field"><label>m³ totais (auto)</label><input class="big readonly" id="m3" readonly></div>
          <div class="field"><label>Incerteza?</label><select class="big" id="incerteza"><option value="false">Não</option><option value="true">Sim</option></select></div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary btn-big" id="clearBtn">Limpar</button>
          <button type="submit" class="btn btn-primary btn-big" id="subBtn">→ Transferir</button>
        </div>
      </form>
    </div>
  `;

  const $ = id => el.querySelector('#'+id);
  const catSel=$('cat'),prodSel=$('prod'),prodStock=$('prodStock'),stockMCF=$('stockMCF'),nMal=$('nMal'),nPec=$('nPec'),m3F=$('m3');

  function fillProducts() {
    const items = mp.filter(x => x.categoria === catSel.value);
    const seen = new Set(); const opts = [];
    for (const it of items) {
      const k = it.produto_conversao || it.produto_stock;
      if (seen.has(k)) continue; seen.add(k);
      opts.push(`<option value="${it.id}">${k}</option>`);
    }
    prodSel.innerHTML = opts.join('');
    onProd();
  }
  const current = () => mp.find(x => x.id === prodSel.value);
  async function onProd() {
    const p = current(); if (!p) return;
    prodStock.value = p.produto_stock;
    nPec.value = p.pecas_por_malote;
    stockMCF.value = 'a carregar...';
    const s = await getStockMCF(p.produto_stock);
    stockMCF.value = s.toFixed(0) + ' malotes';
    recalc();
  }
  function recalc() {
    const p = current(); if (!p) return;
    const nm = parseFloat(nMal.value) || 0;
    const tot = nm * p.pecas_por_malote;
    const vol1 = (p.comprimento/1000)*(p.largura/1000)*(p.espessura/1000);
    m3F.value = (vol1 * tot).toFixed(4) + ' m³';
  }
  catSel.onchange = fillProducts;
  prodSel.onchange = onProd;
  nMal.oninput = recalc;
  $('clearBtn').onclick = () => { nMal.value=''; recalc(); };

  $('fT').onsubmit = async (e) => {
    e.preventDefault();
    const p = current(); if (!p) return;
    const nm = parseFloat(nMal.value);
    if (!nm || nm <= 0) return toast('Indica o número de malotes','error');
    const sMCF = await getStockMCF(p.produto_stock);
    if (nm > sMCF) return toast(`Stock MCF insuficiente (${sMCF} malotes)`,'error');
    const tot = nm * p.pecas_por_malote;
    const vol1 = (p.comprimento/1000)*(p.largura/1000)*(p.espessura/1000);
    const m3v = +(vol1 * tot).toFixed(4);
    const inc = $('incerteza').value === 'true';
    const ok = await showSummary({
      Operação:'Transferência MCF → PSY',
      Produto:p.produto_stock,
      'Malotes × peças':`${nm} × ${p.pecas_por_malote} = ${tot}`,
      Volume:m3v+' m³',
      Incerteza: inc?'Sim':'Não',
    });
    if (!ok) return;
    const btn = $('subBtn'); btn.disabled=true; btn.textContent='A gravar...';
    const res = await addMovimento({
      tipo:'transferencia', empresa:'MCF', empresa_destino:'PSY',
      produto_stock:p.produto_stock, malotes:nm, pecas_por_malote:p.pecas_por_malote, m3:m3v,
      operador_id:ctx.profile.id, incerteza:inc, duvida_resolvida:!inc,
    });
    btn.disabled=false; btn.textContent='→ Transferir';
    toast(res.offline ? '📤 Guardado offline — sincroniza quando houver rede' : '✓ Transferência registada','success');
    nMal.value=''; recalc(); onProd();
    window.dispatchEvent(new CustomEvent('sync-done'));
  };
  fillProducts();
}

function showSummary(obj) {
  return new Promise(resolve => {
    const div = document.createElement('div');
    div.className='modal-overlay';
    div.innerHTML = `<div class="modal"><h3>📋 Confirmar operação</h3>
      ${Object.entries(obj).map(([k,v])=>`<div class="summary-row"><span>${k}</span><b>${v}</b></div>`).join('')}
      <div class="btn-row"><button class="btn btn-secondary" id="c">Cancelar</button><button class="btn btn-success" id="o">✓ Confirmar</button></div></div>`;
    document.body.appendChild(div);
    div.querySelector('#c').onclick=()=>{div.remove();resolve(false)};
    div.querySelector('#o').onclick=()=>{div.remove();resolve(true)};
  });
}
