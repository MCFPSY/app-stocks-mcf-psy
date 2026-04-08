import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

let mpCache = null;
async function loadMP() {
  if (mpCache) return mpCache;
  const { data } = await supabase.from('mp_standard').select('produto_stock').eq('ativo', true).order('produto_stock');
  mpCache = [...new Set((data||[]).map(x => x.produto_stock))];
  return mpCache;
}

export async function renderPedidos(el, ctx) {
  el.innerHTML = `<div class="card"><h2>📋 Pedidos de Transferência</h2><p class="sub">A carregar...</p></div>`;
  const prods = await loadMP();
  await render(el, ctx, prods);
}

async function render(el, ctx, prods) {
  const { data: pedidos } = await supabase.from('pedidos').select('*, profiles!solicitante_id(nome)').order('criado_em', { ascending:false });
  const pend = (pedidos||[]).filter(p => p.estado === 'pendente');

  el.innerHTML = `
    <div class="card">
      <h2>📋 Pedidos de Transferência ${pend.length ? `<span class="tab-badge">${pend.length}</span>` : ''}</h2>
      <p class="sub">Regista pedidos de produto entre MCF e PSY. Outros utilizadores vêem o contador no menu.</p>
      <form id="fP" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;padding:16px;background:#f5f5f7;border-radius:12px">
        <select id="emp" class="big" required><option value="PSY">PSY pede à MCF</option><option value="MCF">MCF pede à PSY</option></select>
        <select id="prod" class="big" required>${prods.map(p=>`<option>${p}</option>`).join('')}</select>
        <input id="mal" class="big" type="number" min="0.01" step="0.01" placeholder="Nº malotes" required>
        <button class="btn btn-primary btn-big" type="submit">+ Criar pedido</button>
      </form>
      <div id="lista"></div>
    </div>
  `;

  el.querySelector('#lista').innerHTML = (pedidos && pedidos.length) ? pedidos.map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px;border:1px solid #d2d2d7;border-radius:12px;margin-bottom:10px;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-weight:600">${p.produto_stock} — ${Number(p.malotes).toFixed(2)} malotes</div>
        <div style="font-size:.8rem;color:#6e6e73">${p.empresa_pede === 'PSY' ? 'PSY → MCF' : 'MCF → PSY'} · ${p.profiles?.nome||'—'} · ${new Date(p.criado_em).toLocaleString('pt-PT')}</div>
      </div>
      <div>
        ${p.estado === 'pendente'
          ? `<span style="background:#fff8e1;color:#f57f17;padding:4px 10px;border-radius:999px;font-size:.75rem;font-weight:600;margin-right:8px">PENDENTE</span>
             <button class="btn btn-success" data-cumprir="${p.id}">✓ Cumprido</button>
             <button class="btn btn-danger" data-cancel="${p.id}">Cancelar</button>`
          : p.estado === 'cumprido'
          ? `<span style="background:#e8f5e9;color:#1b5e20;padding:4px 10px;border-radius:999px;font-size:.75rem;font-weight:600">CUMPRIDO</span>`
          : `<span style="background:#f5f5f5;color:#6e6e73;padding:4px 10px;border-radius:999px;font-size:.75rem;font-weight:600">CANCELADO</span>`}
      </div>
    </div>
  `).join('') : '<p style="color:#888;text-align:center;padding:20px">Sem pedidos registados.</p>';

  el.querySelector('#fP').onsubmit = async (e) => {
    e.preventDefault();
    const emp = el.querySelector('#emp').value;
    const prod = el.querySelector('#prod').value;
    const mal = parseFloat(el.querySelector('#mal').value);
    if (!mal || mal <= 0) return toast('Quantidade inválida','error');
    const { error } = await supabase.from('pedidos').insert({
      empresa_pede: emp, produto_stock: prod, malotes: mal, solicitante_id: ctx.profile.id
    });
    if (error) return toast('Erro: '+error.message,'error');
    toast('✓ Pedido criado','success');
    render(el, ctx, prods);
  };
  el.querySelectorAll('[data-cumprir]').forEach(b => b.onclick = async () => {
    const { error } = await supabase.from('pedidos').update({ estado:'cumprido', resolvido_em: new Date().toISOString() }).eq('id', b.dataset.cumprir);
    if (error) return toast('Erro: '+error.message,'error');
    toast('✓ Marcado cumprido','success'); render(el, ctx, prods);
  });
  el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('Cancelar pedido?')) return;
    const { error } = await supabase.from('pedidos').update({ estado:'cancelado', resolvido_em: new Date().toISOString() }).eq('id', b.dataset.cancel);
    if (error) return toast('Erro: '+error.message,'error');
    toast('✓ Cancelado','success'); render(el, ctx, prods);
  });
}

export async function countPedidosPendentes() {
  const { count } = await supabase.from('pedidos').select('*', { count:'exact', head:true }).eq('estado','pendente');
  return count || 0;
}
