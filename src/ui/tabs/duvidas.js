import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

export async function renderDuvidas(el, ctx) {
  if (!['admin','admin_producao'].includes(ctx.profile.perfil)) {
    el.innerHTML = `<div class="card"><h2>❓ Dúvidas</h2><p class="sub">Acesso restrito a administradores.</p></div>`;
    return;
  }
  await render(el, ctx);
}

async function render(el, ctx) {
  const { data: duvidas } = await supabase.from('movimentos')
    .select('*, profiles!operador_id(nome)')
    .eq('incerteza', true).eq('duvida_resolvida', false)
    .order('criado_em', { ascending:false });
  const { data: mp } = await supabase.from('mp_standard').select('produto_stock').eq('ativo',true).order('produto_stock');
  const prods = [...new Set((mp||[]).map(x=>x.produto_stock))];

  el.innerHTML = `
    <div class="card">
      <h2>❓ Dúvidas — validação manual ${duvidas?.length ? `<span class="tab-badge">${duvidas.length}</span>`:''}</h2>
      <p class="sub">Movimentos marcados com incerteza. Valida ou corrige o produto antes de aplicar.</p>
      <div id="lista"></div>
    </div>
  `;
  const lista = el.querySelector('#lista');
  if (!duvidas?.length) { lista.innerHTML = '<p style="color:#888;text-align:center;padding:20px">✓ Sem dúvidas pendentes.</p>'; return; }

  lista.innerHTML = duvidas.map(d => `
    <div style="padding:16px;border:1px solid #d2d2d7;border-radius:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div><b>${d.tipo}</b> · ${d.empresa}${d.empresa_destino?'→'+d.empresa_destino:''} · ${Number(d.malotes).toFixed(2)} malotes</div>
        <div style="font-size:.8rem;color:#6e6e73">${d.profiles?.nome||'—'} · ${new Date(d.criado_em).toLocaleString('pt-PT')}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <label style="font-size:.85rem">Produto correto:</label>
        <select data-prod="${d.id}" style="padding:10px;border:1px solid #d2d2d7;border-radius:10px;flex:1;min-width:200px">
          ${prods.map(p=>`<option ${p===d.produto_stock?'selected':''}>${p}</option>`).join('')}
        </select>
        <button class="btn btn-success" data-validar="${d.id}">✓ Validar</button>
        <button class="btn btn-danger" data-rejeitar="${d.id}">Rejeitar</button>
      </div>
    </div>
  `).join('');

  lista.querySelectorAll('[data-validar]').forEach(b => b.onclick = async () => {
    const id = b.dataset.validar;
    const novoProd = lista.querySelector(`[data-prod="${id}"]`).value;
    const { error } = await supabase.from('movimentos').update({ produto_stock: novoProd, duvida_resolvida: true }).eq('id', id);
    if (error) return toast('Erro: '+error.message,'error');
    toast('✓ Validado','success'); render(el, ctx);
  });
  lista.querySelectorAll('[data-rejeitar]').forEach(b => b.onclick = async () => {
    if (!confirm('Rejeitar e estornar este movimento?')) return;
    const { error } = await supabase.from('movimentos').update({ estornado: true, duvida_resolvida: true }).eq('id', b.dataset.rejeitar);
    if (error) return toast('Erro: '+error.message,'error');
    toast('✓ Rejeitado','success'); render(el, ctx);
  });
}

export async function countDuvidas() {
  const { count } = await supabase.from('movimentos').select('*',{count:'exact',head:true}).eq('incerteza',true).eq('duvida_resolvida',false);
  return count || 0;
}
