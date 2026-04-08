import { supabase } from '../../supabase.js';

export async function renderInventario(el, ctx) {
  el.innerHTML = `<div class="card"><h2>📊 Inventário Permanente</h2><p class="sub">A carregar stock...</p></div>`;
  const { data, error } = await supabase.from('v_stock').select('*').order('produto_stock');
  if (error) {
    el.innerHTML = `<div class="card"><h2>📊 Inventário Permanente</h2><p class="sub">Erro: ${error.message}</p></div>`;
    return;
  }
  // Agrupar por produto_stock
  const map = new Map();
  for (const r of data) {
    if (!map.has(r.produto_stock)) map.set(r.produto_stock, { produto:r.produto_stock, MCF:0, PSY:0, m3:0 });
    const o = map.get(r.produto_stock);
    o[r.empresa] = Number(r.malotes||0);
    o.m3 += Number(r.m3||0);
  }
  const rows = [...map.values()];
  const totalMal = rows.reduce((s,r)=>s+(r.MCF||0)+(r.PSY||0),0);
  const totalM3 = rows.reduce((s,r)=>s+(r.m3||0),0);

  el.innerHTML = `
    <div class="card">
      <h2>📊 Inventário Permanente</h2>
      <p class="sub">Stock calculado em tempo real a partir dos movimentos (fonte: view v_stock).</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="card" style="margin:0"><div class="sub">Produtos distintos</div><div style="font-size:1.85rem;font-weight:700">${rows.length}</div></div>
        <div class="card" style="margin:0"><div class="sub">Total malotes</div><div style="font-size:1.85rem;font-weight:700">${totalMal.toFixed(0)}</div></div>
        <div class="card" style="margin:0"><div class="sub">Total m³</div><div style="font-size:1.85rem;font-weight:700">${totalM3.toFixed(2)}</div></div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:left;padding:12px;border-bottom:2px solid #e0e0e0">Produto</th>
          <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0">MCF</th>
          <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0">PSY</th>
          <th style="text-align:right;padding:12px;border-bottom:2px solid #e0e0e0">m³</th>
        </tr></thead>
        <tbody>
          ${rows.length===0 ? '<tr><td colspan="4" style="padding:20px;text-align:center;color:#888">Sem stock registado ainda</td></tr>' :
          rows.map(r=>`<tr>
            <td style="padding:12px;border-bottom:1px solid #f0f0f3">${r.produto}</td>
            <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3">${r.MCF.toFixed(0)}</td>
            <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3">${r.PSY.toFixed(0)}</td>
            <td style="padding:12px;text-align:right;border-bottom:1px solid #f0f0f3">${r.m3.toFixed(3)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}
