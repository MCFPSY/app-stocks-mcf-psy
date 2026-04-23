import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

// ==========================================================
// ISO week helpers
// ==========================================================
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}
function weekKey(y, w) { return `${y}-W${String(w).padStart(2, '0')}`; }
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - (dow - 1) + (week - 1) * 7);
  return mon;
}

export async function renderMovimentos(el, ctx) {
  const now = new Date();
  const cw = isoWeek(now);
  // Período: tipo (day/week/month/total)
  let period = { type: 'day', year: cw.year, week: cw.week, day: now.toISOString().slice(0, 10), month: now.toISOString().slice(0, 7) };
  let empresa = 'MCF';

  function periodRange() {
    if (period.type === 'day') return { from: period.day, to: period.day, label: period.day };
    if (period.type === 'week') {
      const mon = isoWeekMonday(period.year, period.week);
      const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
      return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10), label: `${weekKey(period.year, period.week)}` };
    }
    if (period.type === 'month') {
      const [y, m] = period.month.split('-').map(Number);
      const from = `${period.month}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { from, to: `${period.month}-${String(lastDay).padStart(2, '0')}`, label: period.month };
    }
    return { from: '2020-01-01', to: '2099-12-31', label: 'Desde o início' };
  }

  el.innerHTML = '<div class="card"><h2>📅 Movimentos</h2><p class="sub">A carregar...</p></div>';
  await render();

  async function render() {
    const { from, to, label: periodLabel } = periodRange();
    const showContab = period.type === 'day' && empresa; // só faz sentido por dia + empresa

    el.innerHTML = `
      <div class="card">
        <h2>📅 Movimentos ${empresa ? `(${empresa})` : '(MCF + PSY)'}</h2>
        <p class="sub">Todos os movimentos de madeira serrada (MCF) e paletes (PSY). Para a contabilidade lançar no software interno.</p>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
          <div id="mvPeriodToggle" style="display:inline-flex;background:#f5f5f7;border-radius:10px;padding:2px">
            ${['day','week','month','total'].map(t => `
              <button type="button" data-period="${t}" style="padding:6px 14px;border:none;background:${period.type===t?'#fff':'transparent'};color:${period.type===t?'var(--color-blue)':'#666'};border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer;box-shadow:${period.type===t?'0 1px 3px rgba(0,0,0,.1)':'none'}">${({day:'Dia',week:'Semana',month:'Mês',total:'Total'})[t]}</button>
            `).join('')}
          </div>
          ${period.type === 'day' ? `<input type="date" id="dt" value="${period.day}" style="padding:8px 12px;border:2px solid var(--color-border);border-radius:10px;font-size:.9rem">` : ''}
          ${period.type === 'week' ? `<input type="week" id="wk" value="${weekKey(period.year, period.week)}" style="padding:8px 12px;border:2px solid var(--color-border);border-radius:10px;font-size:.9rem">` : ''}
          ${period.type === 'month' ? `<input type="month" id="mt" value="${period.month}" style="padding:8px 12px;border:2px solid var(--color-border);border-radius:10px;font-size:.9rem">` : ''}
          ${period.type === 'total' ? `<span style="font-size:.85rem;color:#666">${periodLabel}</span>` : ''}
          <select id="emp" style="padding:8px 12px;border:2px solid var(--color-border);border-radius:10px;font-size:.9rem">
            <option value="MCF" ${empresa==='MCF'?'selected':''}>MCF</option>
            <option value="PSY" ${empresa==='PSY'?'selected':''}>PSY</option>
            <option value="" ${!empresa?'selected':''}>Ambas</option>
          </select>
          <button class="btn btn-secondary" id="exp">📥 Exportar CSV</button>
        </div>

        <div id="contabBox"></div>
        <div id="tabela"><p class="sub">A carregar...</p></div>
      </div>
    `;

    // Event handlers
    el.querySelector('#mvPeriodToggle').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-period]'); if (!btn) return;
      period.type = btn.dataset.period; render();
    });
    el.querySelector('#dt')?.addEventListener('change', e => { if (e.target.value) { period.day = e.target.value; render(); } });
    el.querySelector('#wk')?.addEventListener('change', e => {
      const v = e.target.value; if (!v) return;
      const [y, w] = v.split('-W'); period.year = +y; period.week = +w; render();
    });
    el.querySelector('#mt')?.addEventListener('change', e => { if (e.target.value) { period.month = e.target.value; render(); } });
    el.querySelector('#emp').addEventListener('change', e => { empresa = e.target.value; render(); });

    // Load movimentos do período (filtra por data_registo, não criado_em)
    let q = supabase.from('movimentos').select('*, profiles!operador_id(nome)')
      .gte('data_registo', from).lte('data_registo', to)
      .order('data_registo', { ascending: false }).order('criado_em', { ascending: false });
    if (empresa) q = q.eq('empresa', empresa);
    const { data, error } = await q;
    if (error) { el.querySelector('#tabela').innerHTML = '<p>Erro: ' + error.message + '</p>'; return; }

    // Contabilização só para dia + empresa específica
    const contabBox = el.querySelector('#contabBox');
    if (showContab) {
      const { data: cb } = await supabase.from('contabilizacao').select('*').eq('data', from).eq('empresa', empresa).maybeSingle();
      contabBox.innerHTML = cb
        ? `<div style="background:#e8f5e9;color:#1b5e20;padding:12px;border-radius:10px;margin-bottom:12px">✓ Dia ${from} (${empresa}) marcado como lançado em ${new Date(cb.marcado_em).toLocaleString('pt-PT')}</div>`
        : `<div style="background:#fff8e1;padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center"><span>⏳ ${from} (${empresa}) ainda não lançado</span><button class="btn btn-primary" id="markBtn">✓ Marcar como lançado</button></div>`;
      const mb = el.querySelector('#markBtn');
      if (mb) mb.onclick = async () => {
        const { error } = await supabase.from('contabilizacao').insert({ data: from, empresa, contabilista_id: ctx.profile.id });
        if (error) return toast('Erro: ' + error.message, 'error');
        toast('✓ Marcado', 'success'); render();
      };
    } else {
      contabBox.innerHTML = '';
    }

    const tabela = el.querySelector('#tabela');
    if (!data?.length) {
      tabela.innerHTML = `<p style="color:#888;text-align:center;padding:20px">Sem movimentos no período (${periodLabel})${empresa ? ` para ${empresa}` : ''}.</p>`;
      return;
    }

    // Totais
    const totMalotes = data.reduce((s, m) => s + Number(m.malotes || 0), 0);
    const totPecas = data.reduce((s, m) => s + Number(m.total_pecas || 0), 0);
    const totM3 = data.reduce((s, m) => s + Number(m.m3 || 0), 0);

    tabela.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.88rem;min-width:860px">
          <thead><tr style="background:#f5f5f7">
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Data</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Hora</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Tipo</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Empresa</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Linha</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Turno</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0">Produto</th>
            <th style="text-align:right;padding:10px;border-bottom:2px solid #e0e0e0">Malotes</th>
            <th style="text-align:right;padding:10px;border-bottom:2px solid #e0e0e0">Peças</th>
            <th style="text-align:right;padding:10px;border-bottom:2px solid #e0e0e0">m³</th>
          </tr></thead>
          <tbody>
            ${data.map(m => `<tr>
              <td style="padding:8px;border-bottom:1px solid #f0f0f3;white-space:nowrap">${m.data_registo || '-'}</td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f3;white-space:nowrap;color:#888">${new Date(m.criado_em).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f3"><span style="background:#e3f2fd;padding:2px 8px;border-radius:8px;font-size:.72rem">${m.tipo}</span></td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f3">${m.empresa}${m.empresa_destino ? ' → ' + m.empresa_destino : ''}</td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f3;font-size:.8rem">${m.linha || '-'}</td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f3">${m.turno || '-'}</td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f3">${m.produto_stock}</td>
              <td style="padding:8px;text-align:right;border-bottom:1px solid #f0f0f3">${Number(m.malotes).toFixed(2)}</td>
              <td style="padding:8px;text-align:right;border-bottom:1px solid #f0f0f3">${Number(m.total_pecas || 0).toFixed(0)}</td>
              <td style="padding:8px;text-align:right;border-bottom:1px solid #f0f0f3">${Number(m.m3 || 0).toFixed(3)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr style="background:#f0f7ff;font-weight:700">
            <td colspan="7" style="padding:10px;border-top:2px solid var(--color-blue)">Total (${data.length} registos)</td>
            <td style="padding:10px;text-align:right;border-top:2px solid var(--color-blue)">${totMalotes.toFixed(2)}</td>
            <td style="padding:10px;text-align:right;border-top:2px solid var(--color-blue)">${totPecas.toFixed(0)}</td>
            <td style="padding:10px;text-align:right;border-top:2px solid var(--color-blue)">${totM3.toFixed(3)}</td>
          </tr></tfoot>
        </table>
      </div>
    `;

    el.querySelector('#exp').onclick = () => {
      const csv = ['data,hora,tipo,empresa,destino,linha,turno,produto,malotes,pecas,m3'].concat(
        data.map(m => [
          m.data_registo || '', new Date(m.criado_em).toLocaleString('pt-PT'), m.tipo, m.empresa,
          m.empresa_destino || '', m.linha || '', m.turno || '', `"${m.produto_stock}"`,
          m.malotes, m.total_pecas || 0, m.m3 || 0
        ].join(','))
      ).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `movimentos_${from}_${to}_${empresa || 'ambas'}.csv`;
      a.click();
    };
  }
}
