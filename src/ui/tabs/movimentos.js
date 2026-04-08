import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

export async function renderMovimentos(el, ctx) {
  const today = new Date().toISOString().slice(0,10);
  el.innerHTML = `
    <div class="card">
      <h2>📅 Movimentos por Dia</h2>
      <p class="sub">Para a contabilidade lançar no software interno.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <input type="date" id="dt" value="${today}" style="padding:11px;border:1px solid #d2d2d7;border-radius:10px;font-size:.95rem">
        <select id="emp" style="padding:11px;border:1px solid #d2d2d7;border-radius:10px;font-size:.95rem">
          <option value="MCF">MCF</option><option value="PSY">PSY</option><option value="">Ambas</option>
        </select>
        <button class="btn btn-secondary" id="reload">🔄 Atualizar</button>
        <button class="btn btn-secondary" id="exp">📥 Exportar CSV</button>
      </div>
      <div id="contabBox"></div>
      <div id="tabela"></div>
    </div>
  `;
  const $ = id => el.querySelector('#'+id);
  async function load() {
    const dt = $('dt').value;
    const emp = $('emp').value;
    let q = supabase.from('movimentos').select('*').gte('criado_em', dt+'T00:00:00').lt('criado_em', dt+'T23:59:59').order('criado_em');
    if (emp) q = q.eq('empresa', emp);
    const { data, error } = await q;
    if (error) { $('tabela').innerHTML = '<p>Erro: '+error.message+'</p>'; return; }

    // check contabilizado
    if (emp) {
      const { data: cb } = await supabase.from('contabilizacao').select('*').eq('data',dt).eq('empresa',emp).maybeSingle();
      $('contabBox').innerHTML = cb
        ? `<div style="background:#e8f5e9;color:#1b5e20;padding:12px;border-radius:10px;margin-bottom:12px">✓ Dia ${dt} (${emp}) marcado como lançado em ${new Date(cb.marcado_em).toLocaleString('pt-PT')}</div>`
        : `<div style="background:#fff8e1;padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center"><span>⏳ ${dt} (${emp}) ainda não lançado no software interno</span><button class="btn btn-primary" id="markBtn">✓ Marcar como lançado</button></div>`;
      const mb = $('markBtn');
      if (mb) mb.onclick = async () => {
        const { error } = await supabase.from('contabilizacao').insert({ data:dt, empresa:emp, contabilista_id:ctx.profile.id });
        if (error) return toast('Erro: '+error.message,'error');
        toast('✓ Marcado','success'); load();
      };
    } else {
      $('contabBox').innerHTML = '';
    }

    if (!data.length) { $('tabela').innerHTML = '<p style="color:#888;text-align:center;padding:20px">Sem movimentos neste dia.</p>'; return; }
    $('tabela').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.9rem">
      <thead><tr>
        <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Hora</th>
        <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Tipo</th>
        <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Empresa</th>
        <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Produto</th>
        <th style="text-align:right;padding:10px;border-bottom:2px solid #e0e0e0">Malotes</th>
        <th style="text-align:right;padding:10px;border-bottom:2px solid #e0e0e0">Peças</th>
        <th style="text-align:right;padding:10px;border-bottom:2px solid #e0e0e0">m³</th>
      </tr></thead><tbody>
      ${data.map(m => `<tr>
        <td style="padding:10px;border-bottom:1px solid #f0f0f3">${new Date(m.criado_em).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</td>
        <td style="padding:10px;border-bottom:1px solid #f0f0f3"><span style="background:#e3f2fd;padding:3px 8px;border-radius:8px;font-size:.75rem">${m.tipo}</span></td>
        <td style="padding:10px;border-bottom:1px solid #f0f0f3">${m.empresa}${m.empresa_destino?'→'+m.empresa_destino:''}</td>
        <td style="padding:10px;border-bottom:1px solid #f0f0f3">${m.produto_stock}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid #f0f0f3">${Number(m.malotes).toFixed(2)}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid #f0f0f3">${Number(m.total_pecas).toFixed(0)}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid #f0f0f3">${Number(m.m3).toFixed(3)}</td>
      </tr>`).join('')}
      </tbody></table>`;
    $('exp').onclick = () => {
      const csv = ['hora,tipo,empresa,destino,produto,malotes,pecas,m3'].concat(
        data.map(m => [new Date(m.criado_em).toLocaleString('pt-PT'),m.tipo,m.empresa,m.empresa_destino||'',m.produto_stock,m.malotes,m.total_pecas,m.m3].join(','))
      ).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
      a.download = `movimentos_${dt}_${emp||'todas'}.csv`; a.click();
    };
  }
  $('reload').onclick = load;
  $('dt').onchange = load;
  $('emp').onchange = load;
  load();
}
