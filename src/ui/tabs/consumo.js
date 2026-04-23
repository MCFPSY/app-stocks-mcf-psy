// Tab "Consumo Rolaria"
// - Ratio editável (admin + edit mode)
// - Breakdown por gama (m³ · tons · %)
// - Drill-down linha-a-linha (cada movimento → gama assumida → tons)

import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

// ========================================================
// ISO week helpers (same as main.js)
// ========================================================
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
function daysOfWeek(year, week) {
  const mon = isoWeekMonday(year, week);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// ========================================================
// Render
// ========================================================
export async function renderConsumo(el, ctx) {
  el.innerHTML = `<div class="card"><h2>Consumo Rolaria</h2><p class="sub">A carregar...</p></div>`;

  const now = new Date();
  const cw = isoWeek(now);
  // Período: tipo (day/week/month/total) + valor selecionado
  let period = { type: 'week', year: cw.year, week: cw.week, day: now.toISOString().slice(0, 10), month: now.toISOString().slice(0, 7) };

  // Calcula from/to ISO dates com base no period state
  function periodRange() {
    if (period.type === 'day') return { from: period.day, to: period.day, label: period.day };
    if (period.type === 'week') {
      const days = daysOfWeek(period.year, period.week);
      return { from: days[0], to: days[6], label: `${weekKey(period.year, period.week)} (${days[0]} → ${days[6]})` };
    }
    if (period.type === 'month') {
      const [y, m] = period.month.split('-').map(Number);
      const from = `${period.month}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const to = `${period.month}-${String(lastDay).padStart(2, '0')}`;
      return { from, to, label: period.month };
    }
    // total
    return { from: '2020-01-01', to: '2099-12-31', label: 'Desde o início' };
  }

  await render();

  async function render() {
    const { from: weekStart, to: weekEnd, label: periodLabel } = periodRange();

    // Load all data in parallel
    // Nota: rolaria_tons e rolaria_gama lêem-se diretamente de movimentos
    // (persistidos ao submeter). Fallback recomputa se NULL (movimentos antigos).
    const [configRes, gamasRes, matrizRes, linhasRes, movsRes, mpRes] = await Promise.all([
      supabase.from('consumo_config').select('*'),
      supabase.from('rolaria_gamas').select('*').eq('ativo', true),
      supabase.from('rolaria_matriz_principal').select('*'),
      supabase.from('mcf_linhas').select('*').eq('ativo', true).order('ordem'),
      supabase.from('movimentos')
        .select('id, linha, turno, data_registo, produto_stock, m3, malotes, rolaria_tons, rolaria_gama')
        .eq('tipo', 'entrada_producao').eq('empresa', 'MCF')
        .eq('estornado', false).eq('duvida_resolvida', true)
        .not('linha', 'is', null)
        .gte('data_registo', weekStart).lte('data_registo', weekEnd),
      supabase.from('mp_standard').select('produto_stock, comprimento, largura, espessura').eq('ativo', true),
    ]);

    const configMap = {};
    for (const c of (configRes.data || [])) configMap[c.chave] = Number(c.valor);
    const ratio = configMap['ratio_ton_m3'] || 2.129925;

    const gamas = gamasRes.data || [];
    const gamaById = Object.fromEntries(gamas.map(g => [g.id, g]));
    const matriz = matrizRes.data || [];
    const linhas = linhasRes.data || [];
    const linhaByNome = Object.fromEntries(linhas.map(l => [l.nome, l]));
    const movs = (movsRes.data || []).sort((a, b) => (a.data_registo || '').localeCompare(b.data_registo || '') || (a.linha || '').localeCompare(b.linha || ''));
    const mpMap = {};
    for (const p of (mpRes.data || [])) mpMap[p.produto_stock] = p;

    // ========================================================
    // Gama determination algorithm
    // ========================================================

    // Helper: turno key for inheritance
    function turnoKey(m) { return `${m.data_registo}|${m.turno}`; }

    // Pre-compute: principal gama per turno (for aproveitamentos inheritance)
    const principalGamaPerTurno = new Map(); // turnoKey -> gama
    // Pre-compute: charriot [B] gama per turno (for duplos/tábuas inheritance)
    const charriotBGamaPerTurno = new Map();
    // Pre-compute: aproveitamentos product per turno (for costaneiro espessura)
    const aprovProdPerTurno = new Map(); // turnoKey -> espessura

    // First pass: determine direct gamas (principal + charriot [B])
    const movGamas = new Map(); // mov.id -> { gama, tons }

    // Pre-pass: para movimentos com rolaria_tons/gama persistidos no DB, usa esses
    // valores (autoritativos). Senão cai para o algoritmo dinâmico nas passes 1+2.
    for (const m of movs) {
      if (m.rolaria_tons != null || m.rolaria_gama != null) {
        const gama = m.rolaria_gama ? gamas.find(g => g.nome === m.rolaria_gama) : null;
        movGamas.set(m.id, {
          gama,
          tons: Number(m.rolaria_tons) || 0,
          reason: 'Persistido na BD',
        });
      }
    }

    function lookupMatrizPrincipal(comp, larg, esp, costaneiroEsp) {
      for (const row of matriz) {
        if (row.comp_produto_mm !== comp) continue;
        if (larg < row.larg_min || larg > row.larg_max) continue;
        if (esp > row.esp_max) continue;
        // Costaneiro filter (null = any)
        if (row.costaneiro_esp_min != null && row.costaneiro_esp_max != null) {
          if (costaneiroEsp == null) continue;
          if (costaneiroEsp < row.costaneiro_esp_min || costaneiroEsp > row.costaneiro_esp_max) continue;
        }
        return gamaById[row.gama_id] || null;
      }
      return null;
    }

    function lookupCharriotGama(comp, categoria) {
      return gamas.find(g => g.comp_rolaria_mm === comp && g.categoria === categoria) || null;
    }

    // Collect aproveitamentos espessura per turno (regular + (B))
    for (const m of movs) {
      const linha = linhaByNome[m.linha];
      if (!linha) continue;
      if (linha.tipo_benchmark === 'aproveitamentos' && linha.sinal === '+') {
        const p = mpMap[m.produto_stock];
        if (p) aprovProdPerTurno.set(turnoKey(m), p.espessura);
      }
    }

    const isBLine = (nome) => / \(B\)$/.test(nome);

    // Pass 1: principal + charriot [B] — também popula os maps de inheritance
    // (inclusive para os já-persistidos, para que aproveitamentos saibam herdar)
    for (const m of movs) {
      const linha = linhaByNome[m.linha];
      if (!linha) continue;
      const p = mpMap[m.produto_stock];
      const tk = turnoKey(m);

      if (linha.tipo_benchmark === 'principal' && !isBLine(linha.nome)) {
        // Se já persistido, só popula maps de inheritance a partir da gama guardada
        if (movGamas.has(m.id)) {
          const g = movGamas.get(m.id).gama;
          if (g && !principalGamaPerTurno.has(tk)) principalGamaPerTurno.set(tk, g);
          continue;
        }
        if (!p) { movGamas.set(m.id, { gama: null, tons: 0, reason: 'Produto não encontrado' }); continue; }
        const costEsp = aprovProdPerTurno.get(tk) || null;
        const gama = lookupMatrizPrincipal(p.comprimento, p.largura, p.espessura, costEsp);
        movGamas.set(m.id, { gama, tons: m.m3 * ratio, reason: gama ? null : 'Sem match na matriz' });
        if (gama && !principalGamaPerTurno.has(tk)) principalGamaPerTurno.set(tk, gama);
      } else if (linha.tipo_benchmark === 'charriot' && m.linha === 'Linha charriot [B]') {
        if (movGamas.has(m.id)) {
          const g = movGamas.get(m.id).gama;
          if (g && !charriotBGamaPerTurno.has(tk)) charriotBGamaPerTurno.set(tk, g);
          continue;
        }
        if (!p) { movGamas.set(m.id, { gama: null, tons: 0, reason: 'Produto não encontrado' }); continue; }
        const gama = lookupCharriotGama(p.comprimento, 'charriot_barrotes');
        movGamas.set(m.id, { gama, tons: m.m3 * ratio, reason: gama ? null : 'Sem gama barrotes' });
        if (gama && !charriotBGamaPerTurno.has(tk)) charriotBGamaPerTurno.set(tk, gama);
      }
    }

    // Weekly fallback gama: produto mais consumido (m³) pela linha principal
    // regular na semana. Usado quando aprov (B) não tem principal mesmo turno.
    function computeWeeklyFallback() {
      const byProd = new Map();
      for (const m of movs) {
        const linha = linhaByNome[m.linha];
        if (!linha || linha.tipo_benchmark !== 'principal' || isBLine(linha.nome)) continue;
        if (!m.produto_stock) continue;
        byProd.set(m.produto_stock, (byProd.get(m.produto_stock) || 0) + Number(m.m3 || 0));
      }
      if (byProd.size === 0) return null;
      const topProd = [...byProd.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const p = mpMap[topProd];
      if (!p) return null;
      return lookupMatrizPrincipal(p.comprimento, p.largura, p.espessura, null);
    }
    const weeklyFallbackGama = computeWeeklyFallback();

    // Pass 2: inherited gamas (aproveitamentos, duplos, tábuas) + PSY/sobras
    for (const m of movs) {
      if (movGamas.has(m.id)) continue;
      const linha = linhaByNome[m.linha];
      if (!linha) { movGamas.set(m.id, { gama: null, tons: 0, reason: 'Linha desconhecida' }); continue; }
      const tk = turnoKey(m);

      if (linha.sinal === '-') {
        movGamas.set(m.id, { gama: null, tons: 0, reason: 'Retestagem (sem consumo rolaria)' });
      } else if (linha.tipo_benchmark === 'aproveitamentos') {
        if (isBLine(linha.nome)) {
          // (B): T2 nunca tem principal. T1/T3 → tentar principal mesmo turno, senão fallback semanal
          let gama = null, reason = '';
          if (m.turno === 'T2') {
            gama = weeklyFallbackGama;
            reason = gama ? 'Fallback semanal (principal + consumida)' : 'Sem principal na semana';
          } else {
            gama = principalGamaPerTurno.get(tk) || weeklyFallbackGama;
            reason = principalGamaPerTurno.get(tk) ? 'Herdado da principal (mesmo turno)'
                   : (gama ? 'Fallback semanal (principal sem trabalho no turno)' : 'Sem principal na semana');
          }
          movGamas.set(m.id, { gama, tons: m.m3 * ratio, reason });
        } else {
          const gama = principalGamaPerTurno.get(tk) || null;
          movGamas.set(m.id, { gama, tons: m.m3 * ratio, reason: gama ? 'Herdado da principal' : 'Sem principal no turno' });
        }
      } else if (linha.tipo_benchmark === 'charriot') {
        const gama = charriotBGamaPerTurno.get(tk) || null;
        movGamas.set(m.id, { gama, tons: m.m3 * ratio, reason: gama ? 'Herdado do charriot [B]' : 'Sem [B] no turno' });
      } else {
        movGamas.set(m.id, { gama: null, tons: m.m3 * ratio, reason: 'Tipo desconhecido' });
      }
    }

    // ========================================================
    // Aggregate by gama
    // ========================================================
    const byGama = new Map(); // gama.nome -> { m3, tons }
    let totalM3 = 0, totalTons = 0;
    for (const m of movs) {
      const info = movGamas.get(m.id);
      if (!info) continue;
      const gNome = info.gama ? info.gama.nome : '(sem gama)';
      if (!byGama.has(gNome)) byGama.set(gNome, { m3: 0, tons: 0 });
      const b = byGama.get(gNome);
      b.m3 += Number(m.m3) || 0;
      b.tons += info.tons;
      totalM3 += Number(m.m3) || 0;
      totalTons += info.tons;
    }

    // Sort gamas by name
    const gamaRows = [...byGama.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // ========================================================
    // Build HTML
    // ========================================================
    const isEdit = window.__editMode === true;
    const isAdmin = ctx.profile.perfil === 'admin';

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
          <h2 style="margin:0">Consumo Rolaria</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div id="crPeriodToggle" style="display:inline-flex;background:#f5f5f7;border-radius:10px;padding:2px">
              ${['day','week','month','total'].map(t => `
                <button type="button" data-period="${t}" style="padding:6px 14px;border:none;background:${period.type===t?'#fff':'transparent'};color:${period.type===t?'var(--color-blue)':'#666'};border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer;box-shadow:${period.type===t?'0 1px 3px rgba(0,0,0,.1)':'none'}">${({day:'Dia',week:'Semana',month:'Mês',total:'Total'})[t]}</button>
              `).join('')}
            </div>
            ${period.type === 'day' ? `<input type="date" id="crDayPicker" value="${period.day}" style="padding:8px 12px;border:2px solid var(--color-border);border-radius:10px;font-size:.9rem">` : ''}
            ${period.type === 'week' ? `<input type="week" id="crWeekPicker" value="${weekKey(period.year, period.week)}" style="padding:8px 12px;border:2px solid var(--color-border);border-radius:10px;font-size:.9rem">` : ''}
            ${period.type === 'month' ? `<input type="month" id="crMonthPicker" value="${period.month}" style="padding:8px 12px;border:2px solid var(--color-border);border-radius:10px;font-size:.9rem">` : ''}
            ${period.type === 'total' ? `<span style="font-size:.85rem;color:#666">${periodLabel}</span>` : ''}
          </div>
        </div>

        <div style="display:flex;gap:24px;align-items:center;margin-bottom:18px;flex-wrap:wrap">
          <div style="background:#f0f7ff;padding:10px 16px;border-radius:10px;display:flex;align-items:center;gap:8px">
            <span style="font-size:.8rem;color:#666">Ratio ton/m³:</span>
            ${isEdit && isAdmin
              ? `<input type="number" id="crRatioInput" value="${ratio}" step="0.000001" min="0"
                  style="width:110px;padding:6px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:.95rem;font-weight:600;text-align:center">
                 <button id="crRatioSave" style="padding:4px 12px;background:var(--color-blue);color:#fff;border:none;border-radius:8px;font-size:.8rem;cursor:pointer">Gravar</button>`
              : `<span style="font-weight:700;font-size:1rem">${ratio}</span>`
            }
          </div>
          <div style="display:flex;gap:16px">
            <div style="text-align:center">
              <div style="font-size:.7rem;color:#888;text-transform:uppercase">m³ serrada</div>
              <div style="font-size:1.3rem;font-weight:700">${totalM3.toFixed(2)}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.7rem;color:#888;text-transform:uppercase">Tons rolaria</div>
              <div style="font-size:1.3rem;font-weight:700;color:var(--color-blue)">${totalTons.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <!-- Breakdown por gama -->
        <h3 style="font-size:.95rem;color:#333;margin:0 0 8px">Breakdown por gama</h3>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.85rem">
            <thead>
              <tr style="background:#f5f5f7">
                <th style="text-align:left;padding:8px;border-bottom:2px solid #e0e0e0">Gama</th>
                <th style="text-align:right;padding:8px;border-bottom:2px solid #e0e0e0">m³</th>
                <th style="text-align:right;padding:8px;border-bottom:2px solid #e0e0e0">Tons</th>
                <th style="text-align:right;padding:8px;border-bottom:2px solid #e0e0e0">%</th>
              </tr>
            </thead>
            <tbody>
              ${gamaRows.map(([nome, v]) => {
                const pct = totalTons > 0 ? (v.tons / totalTons * 100) : 0;
                const isNone = nome === '(sem gama)';
                return `<tr style="${isNone ? 'color:#999;font-style:italic' : ''}">
                  <td style="padding:6px 8px">${nome}</td>
                  <td style="padding:6px 8px;text-align:right">${v.m3.toFixed(2)}</td>
                  <td style="padding:6px 8px;text-align:right;font-weight:600">${v.tons.toFixed(2)}</td>
                  <td style="padding:6px 8px;text-align:right">${pct.toFixed(1)}%</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="font-weight:700;border-top:2px solid var(--color-blue);background:#f0f7ff">
                <td style="padding:8px">Total</td>
                <td style="padding:8px;text-align:right">${totalM3.toFixed(2)}</td>
                <td style="padding:8px;text-align:right">${totalTons.toFixed(2)}</td>
                <td style="padding:8px;text-align:right">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Drill-down linha-a-linha -->
      <div class="card">
        <h3 style="font-size:.95rem;color:#333;margin:0 0 8px">Detalhe linha-a-linha <span style="font-size:.75rem;color:#888;font-weight:400">(${movs.length} registos)</span></h3>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.8rem;min-width:800px">
            <thead>
              <tr style="background:#f5f5f7">
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e0e0e0">Data</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e0e0e0">Turno</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e0e0e0">Linha</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e0e0e0">Produto</th>
                <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e0e0e0">m³</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e0e0e0">Gama assumida</th>
                <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e0e0e0">Tons</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e0e0e0">Nota</th>
              </tr>
            </thead>
            <tbody>
              ${movs.map(m => {
                const info = movGamas.get(m.id) || { gama: null, tons: 0, reason: '' };
                const isMinus = linhaByNome[m.linha]?.sinal === '-';
                const rowStyle = isMinus ? 'color:#999;font-style:italic' : (info.gama ? '' : 'background:#fff3cd');
                return `<tr style="${rowStyle}">
                  <td style="padding:5px 8px">${m.data_registo || ''}</td>
                  <td style="padding:5px 8px">${m.turno || ''}</td>
                  <td style="padding:5px 8px;white-space:nowrap">${m.linha || ''}</td>
                  <td style="padding:5px 8px">${m.produto_stock || ''}</td>
                  <td style="padding:5px 8px;text-align:right">${(Number(m.m3) || 0).toFixed(3)}</td>
                  <td style="padding:5px 8px">${info.gama ? info.gama.nome : '—'}</td>
                  <td style="padding:5px 8px;text-align:right;font-weight:600">${info.tons.toFixed(2)}</td>
                  <td style="padding:5px 8px;font-size:.75rem;color:#888">${info.reason || ''}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${movs.length === 0 ? `<p style="text-align:center;color:#888;margin:16px 0">Sem registos no período (${periodLabel})</p>` : ''}
      </div>
    `;

    // ========================================================
    // Event handlers
    // ========================================================
    // Toggle período (Dia/Semana/Mês/Total)
    el.querySelector('#crPeriodToggle')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-period]');
      if (!btn) return;
      period.type = btn.dataset.period;
      render();
    });
    el.querySelector('#crDayPicker')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      period.day = e.target.value;
      render();
    });
    el.querySelector('#crWeekPicker')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      const [y, wStr] = val.split('-W');
      period.year = parseInt(y);
      period.week = parseInt(wStr);
      render();
    });
    el.querySelector('#crMonthPicker')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      period.month = e.target.value;
      render();
    });

    // Ratio save
    const ratioBtn = el.querySelector('#crRatioSave');
    if (ratioBtn) {
      ratioBtn.addEventListener('click', async () => {
        const inp = el.querySelector('#crRatioInput');
        const newVal = parseFloat(inp.value);
        if (isNaN(newVal) || newVal <= 0) { toast('Ratio inválido', 'error'); return; }
        const { error } = await supabase.from('consumo_config').update({ valor: newVal, atualizado_em: new Date().toISOString() }).eq('chave', 'ratio_ton_m3');
        if (error) { toast(`Erro: ${error.message}`, 'error'); return; }
        toast('Ratio atualizado', 'success');
        render();
      });
    }
  }
}
