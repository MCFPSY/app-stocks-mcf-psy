import { supabase } from '../../supabase.js';

let currentEmpresa = 'mcf';
let currentCtx = null;
// (window.__editMode === true) now comes from global window.__(window.__editMode === true) set by header button

// ========================================================
// ISO week helpers
// ========================================================
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNum };
}
function weekKey(year, week) { return `${year}-W${String(week).padStart(2,'0')}`; }
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (week - 1) * 7);
  return monday;
}
function daysOfWeek(year, week) {
  const mon = isoWeekMonday(year, week);
  const labels = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const todayIso = new Date().toISOString().slice(0,10);
  return Array.from({length:7}, (_, i) => {
    const d = new Date(mon); d.setUTCDate(mon.getUTCDate()+i);
    const iso = d.toISOString().slice(0,10);
    return { iso, label: labels[i], dayNum: d.getUTCDate(), todayFlag: iso === todayIso };
  });
}
function previousWeeks(baseYear, baseWeek, n) {
  const out = [];
  let y = baseYear, w = baseWeek;
  for (let i = 0; i < n; i++) {
    w--;
    if (w < 1) { y--; w = isoWeek(new Date(Date.UTC(y, 11, 28))).week; }
    out.unshift({ year: y, week: w, key: weekKey(y, w), label: `W${String(w).padStart(2,'0')}` });
  }
  return out;
}

// ========================================================
// Color helpers
// ========================================================
function pctColor(p) {
  if (!p) return '#6e6e73';
  if (p >= 95) return '#1b5e20';
  if (p <  85) return '#c62828';
  return '#1d1d1f';
}
function pctBg(p) {
  if (!p) return '';
  if (p >= 95) return 'background:rgba(76,175,80,0.18);';
  if (p <  85) return 'background:rgba(244,67,54,0.18);';
  return '';
}

// ========================================================
// Main entry
// ========================================================
export async function renderMain(el, ctx) {
  currentCtx = ctx;
  const today = new Date();
  const now = isoWeek(today);

  el.innerHTML = `
    <div class="card" id="dashCard">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">📈 Dashboard — Controlo de Produção</h2>
        <button type="button" id="fullscreenBtn" title="Ecrã inteiro" style="background:transparent;border:1px solid var(--color-border);cursor:pointer;padding:6px 10px;border-radius:6px;font-size:.85rem;display:flex;align-items:center;gap:6px">
          <span id="fsIcon">⛶</span> <span id="fsLabel">Ecrã inteiro</span>
        </button>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="min-width:180px">
          <label>Semana de referência</label>
          <input id="weekPicker" type="week" value="${now.year}-W${String(now.week).padStart(2,'0')}" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
        </div>
        <div class="field" style="min-width:150px">
          <label>Data (hoje)</label>
          <input id="dayPicker" type="date" value="${today.toISOString().slice(0,10)}" style="padding:10px 14px;border:2px solid var(--color-border);border-radius:10px;font-size:.95rem">
        </div>
        <div style="flex:1"></div>
      </div>
      <div style="display:flex;gap:6px;background:#f5f5f7;padding:6px;border-radius:14px;margin-bottom:20px">
        <button class="dash-mode active" data-mode="mcf" style="flex:1;padding:12px;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer">🪵 MCF</button>
        <button class="dash-mode" data-mode="psy" style="flex:1;padding:12px;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;background:transparent;color:var(--color-text-2)">📦 PSY</button>
      </div>
      <div id="dashContent"><p class="sub">A carregar...</p></div>
    </div>
  `;

  const empresaBtns = el.querySelectorAll('.dash-mode');
  empresaBtns.forEach(btn => btn.addEventListener('click', () => {
    currentEmpresa = btn.dataset.mode;
    empresaBtns.forEach(b => {
      b.classList.toggle('active', b === btn);
      if (b === btn) { b.style.background = ''; b.style.color = ''; }
      else { b.style.background = 'transparent'; b.style.color = 'var(--color-text-2)'; }
    });
    load();
  }));

  el.querySelector('#weekPicker').addEventListener('change', load);
  el.querySelector('#dayPicker').addEventListener('change', load);

  const fsBtn = el.querySelector('#fullscreenBtn');
  if (fsBtn) fsBtn.addEventListener('click', () => {
    const card = el.querySelector('#dashCard');
    if (!document.fullscreenElement) {
      card.requestFullscreen().catch(err => alert('Erro a entrar em ecrã inteiro: ' + err.message));
    } else {
      document.exitFullscreen();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const card = el.querySelector('#dashCard');
    if (!card) return;
    const fsLabel = el.querySelector('#fsLabel');
    if (document.fullscreenElement === card) {
      card.style.background = '#fff';
      card.style.padding = '20px';
      card.style.overflow = 'auto';
      if (fsLabel) fsLabel.textContent = 'Sair do ecrã inteiro';
    } else {
      card.style.background = '';
      card.style.padding = '';
      card.style.overflow = '';
      if (fsLabel) fsLabel.textContent = 'Ecrã inteiro';
    }
  });

  async function load() {
    const picker = el.querySelector('#weekPicker').value;
    const dayIso = el.querySelector('#dayPicker').value;
    const [y, w] = picker.split('-W').map(Number);

    const pastWeeks = previousWeeks(y, w, 7);        // 7 weeks BEFORE the selected week
    const currentWeek = { year: y, week: w, key: weekKey(y, w) };
    const days = daysOfWeek(y, w);

    const content = el.querySelector('#dashContent');
    content.innerHTML = '<p class="sub">A carregar...</p>';

    if (currentEmpresa === 'mcf') await renderMCF(content, pastWeeks, currentWeek, days, dayIso);
    else await renderPSY(content, pastWeeks, currentWeek, days, dayIso);

    // Re-bind after re-render
    const toggleBtn = content.querySelector('#togglePastBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', () => { pastCollapsed = !pastCollapsed; load(); });

    // Scroll to right on initial render so today is visible
    const scrollWrapper = content.querySelector('div[style*="overflow-x:auto"]');
    if (scrollWrapper) {
      setTimeout(() => { scrollWrapper.scrollLeft = scrollWrapper.scrollWidth; }, 50);
    }

    // HC edit persistence
    content.querySelectorAll('[data-hc-linha]').forEach(input => {
      input.addEventListener('change', async () => {
        const linha = input.dataset.hcLinha;
        const empresa = input.dataset.hcEmpresa;
        const hc = parseInt(input.value) || 0;
        const table = empresa === 'mcf' ? 'mcf_linhas' : 'psy_linhas';
        const { error } = await supabase.from(table).update({ hc }).eq('nome', linha);
        if (error) alert('Erro a gravar HC: ' + error.message);
      });
    });

    // Paragens persistence (localStorage)
    content.querySelectorAll('[data-paragem-idx]').forEach(input => {
      input.addEventListener('change', () => {
        const key = input.dataset.paragemKey;
        const idx = parseInt(input.dataset.paragemIdx);
        const arr = JSON.parse(localStorage.getItem(key) || '["","",""]');
        arr[idx] = input.value.trim();
        localStorage.setItem(key, JSON.stringify(arr));
      });
    });
  }

  load();
}

// ========================================================
// MCF Dashboard
// ========================================================
async function renderMCF(el, pastWeeks, currentWeek, days, dayIso) {
  const allWeekKeys = [...pastWeeks.map(w => w.key), currentWeek.key];
  const weekStartIso = days[0].iso;
  const weekEndIso = days[6].iso;

  const [linhasRes, semanalRes, movRes, bmRes] = await Promise.all([
    supabase.from('mcf_linhas').select('*').eq('ativo', true).order('ordem'),
    supabase.from('v_mcf_semanal').select('*').in('semana', allWeekKeys),
    // Raw movimentos for current week (need daily + today breakdown)
    supabase.from('movimentos').select('linha, data_registo, criado_em, produto_stock, m3, malotes, desvio_objetivo')
      .eq('tipo','entrada_producao').eq('empresa','MCF').eq('estornado',false).eq('duvida_resolvida',true)
      .not('linha','is',null)
      .gte('data_registo', weekStartIso).lte('data_registo', weekEndIso),
    supabase.from('aux_benchmark').select('*'),
  ]);

  if (linhasRes.error) { el.innerHTML = `<p>Erro: ${linhasRes.error.message}</p>`; return; }
  const linhas = linhasRes.data;
  const semanal = semanalRes.data || [];
  const movs = movRes.data || [];
  const bmMap = new Map((bmRes.data || []).map(b => [`${b.produto_stock}|${b.tipo_linha}`, Number(b.target_m3_malote)]));

  // Aggregate past weeks: linha -> weekKey -> { m3, plano, produtos(Set) }
  // plano = sum of benchmark per DISTINCT product produced (not × malotes)
  const weekly = new Map();
  for (const l of linhas) weekly.set(l.nome, {});
  for (const r of semanal) {
    if (!pastWeeks.find(w => w.key === r.semana)) continue;
    const linha = linhas.find(l => l.nome === r.linha); if (!linha) continue;
    const buck = weekly.get(linha.nome);
    if (!buck[r.semana]) buck[r.semana] = { m3: 0, plano: 0, produtos: new Set() };
    buck[r.semana].m3 += Number(r.m3_total || 0);
    if (!buck[r.semana].produtos.has(r.produto_stock)) {
      buck[r.semana].produtos.add(r.produto_stock);
      const bm = bmMap.get(`${r.produto_stock}|${linha.tipo_benchmark}`);
      buck[r.semana].plano += bm || 0;
    }
  }

  // Sort movs by criado_em ascending (to capture first product of day)
  const movsSorted = [...movs].sort((a, b) => (a.criado_em || '').localeCompare(b.criado_em || ''));

  // Aggregate current week by day: linha -> dayIso -> { m3, plano, produtos, firstProduto }
  const byDay = new Map();
  for (const l of linhas) byDay.set(l.nome, {});
  for (const m of movsSorted) {
    const linha = linhas.find(l => l.nome === m.linha); if (!linha) continue;
    const d = m.data_registo || m.criado_em.slice(0,10);
    const buck = byDay.get(linha.nome);
    if (!buck[d]) buck[d] = { m3: 0, plano: 0, produtos: new Set(), firstProduto: m.produto_stock, desvios: [] };
    buck[d].m3 += Number(m.m3 || 0);
    if (!buck[d].produtos.has(m.produto_stock)) {
      buck[d].produtos.add(m.produto_stock);
      const bm = bmMap.get(`${m.produto_stock}|${linha.tipo_benchmark}`);
      buck[d].plano += bm || 0;
    }
    if (m.desvio_objetivo && m.desvio_objetivo.trim()) {
      buck[d].desvios.push(m.desvio_objetivo.trim());
    }
  }

  // Build rows (track real + plano per cell for per-cell coloring)
  const rows = linhas.map(l => {
    const pastBuck = weekly.get(l.nome);
    const pastWeekly = pastWeeks.map(w => ({ real: (pastBuck[w.key]?.m3) || 0, plano: (pastBuck[w.key]?.plano) || 0 }));
    const pastAccReal = pastWeekly.reduce((s,c) => s+c.real, 0);
    const pastAccPlan = pastWeekly.reduce((s,c) => s+c.plano, 0);

    const dayBuck = byDay.get(l.nome);
    const dailyCells = days.map(d => ({ real: (dayBuck[d.iso]?.m3) || 0, plano: (dayBuck[d.iso]?.plano) || 0 }));
    const weekReal = dailyCells.reduce((s,c) => s+c.real, 0);
    const weekPlan = dailyCells.reduce((s,c) => s+c.plano, 0);

    const todayReal = (dayBuck[dayIso]?.m3) || 0;
    const todayPlan = (dayBuck[dayIso]?.plano) || 0;
    const todayProduto = (dayBuck[dayIso]?.firstProduto) || '';
    const todayCausas = (dayBuck[dayIso]?.desvios || []).join(' · ');

    return {
      linha: l,
      pastWeekly, pastAccReal, pastAccPlan,
      dailyCells, weekReal, weekPlan,
      todayReal, todayPlan, todayProduto, todayCausas,
    };
  });

  // Totals (respecting +/- sinal) — each cell now has {real, plano}
  const sign = l => l.sinal === '-' ? -1 : 1;
  const pastWeeklyTot = pastWeeks.map((_, i) => ({
    real: rows.reduce((s,r) => s + sign(r.linha) * r.pastWeekly[i].real, 0),
    plano: rows.reduce((s,r) => s + sign(r.linha) * r.pastWeekly[i].plano, 0),
  }));
  const dailyTot = days.map((_, i) => ({
    real: rows.reduce((s,r) => s + sign(r.linha) * r.dailyCells[i].real, 0),
    plano: rows.reduce((s,r) => s + sign(r.linha) * r.dailyCells[i].plano, 0),
  }));
  const pastAccRealTot = rows.reduce((s,r) => s + sign(r.linha) * r.pastAccReal, 0);
  const pastAccPlanTot = rows.reduce((s,r) => s + sign(r.linha) * r.pastAccPlan, 0);
  const weekRealTot = rows.reduce((s,r) => s + sign(r.linha) * r.weekReal, 0);
  const weekPlanTot = rows.reduce((s,r) => s + sign(r.linha) * r.weekPlan, 0);
  const todayRealTot = rows.reduce((s,r) => s + sign(r.linha) * r.todayReal, 0);
  const todayPlanTot = rows.reduce((s,r) => s + sign(r.linha) * r.todayPlan, 0);
  const totalHC = rows.reduce((s,r) => s + (r.linha.hc || 0), 0);

  el.innerHTML = buildTable({
    rows, pastWeeks, days, dayIso,
    pastWeeklyTot, dailyTot,
    pastAccRealTot, pastAccPlanTot, weekRealTot, weekPlanTot, todayRealTot, todayPlanTot,
    totalHC, totalLabel: 'Total MCF', unit: 'm³', fmt: v => v ? v.toFixed(1) : '—', fmtPlan: v => v ? v.toFixed(0) : '—',
  });
}

// ========================================================
// PSY Dashboard
// ========================================================
async function renderPSY(el, pastWeeks, currentWeek, days, dayIso) {
  const allWeekKeys = [...pastWeeks.map(w => w.key), currentWeek.key];
  const weekStartIso = days[0].iso;
  const weekEndIso = days[6].iso;

  const [semanalRes, prodRes] = await Promise.all([
    supabase.from('v_psy_semanal').select('*').in('semana', allWeekKeys),
    supabase.from('psy_producao').select('linha, turno, data_registo, quantidade, produto, desvio_objetivo')
      .gte('data_registo', weekStartIso).lte('data_registo', weekEndIso),
  ]);
  if (semanalRes.error) { el.innerHTML = `<p>Erro: ${semanalRes.error.message}</p>`; return; }

  const rowDefs = [
    { linha:'Linha 01', turno:'T1', hc:5 }, { linha:'Linha 01', turno:'T2', hc:5 },
    { linha:'Linha 02', turno:null, hc:2 }, { linha:'Linha 03', turno:null, hc:0 },
    { linha:'Linha 04', turno:null, hc:1 }, { linha:'Linha 05', turno:null, hc:0 },
    { linha:'Linha 06', turno:null, hc:1 }, { linha:'Linha 07', turno:'T1', hc:2 },
    { linha:'Linha 08', turno:'T1', hc:2 }, { linha:'Linha 08', turno:'T2', hc:3 },
    { linha:'Tampos',   turno:null, hc:2 },
    { linha:'Bancadas', turno:null, hc:4 },
    { linha:'Robot',    turno:'T1', hc:1 }, { linha:'Robot', turno:'T2', hc:1 },
  ];

  const semanal = semanalRes.data || [];
  const movs = prodRes.data || [];

  const rows = rowDefs.map(rd => {
    const label = rd.turno ? `${rd.linha} ${rd.turno}` : rd.linha;
    const match = (r) => r.linha === rd.linha && (!rd.turno || r.turno === rd.turno);

    const pastWeekly = pastWeeks.map(w => ({
      real: semanal.filter(r => match(r) && r.semana === w.key).reduce((s,r) => s + Number(r.qty_total || 0), 0),
      plano: 0,
    }));
    const pastAccReal = pastWeekly.reduce((s,c) => s+c.real, 0);

    const dailyCells = days.map(d => ({
      real: movs.filter(m => match(m) && m.data_registo === d.iso).reduce((s,m) => s + Number(m.quantidade || 0), 0),
      plano: 0,
    }));
    const weekReal = dailyCells.reduce((s,c) => s+c.real, 0);
    const todayMovs = movs.filter(m => match(m) && m.data_registo === dayIso);
    const todayReal = todayMovs.reduce((s,m) => s + Number(m.quantidade || 0), 0);
    const todayProduto = todayMovs[0]?.produto || '';
    const todayCausas = [...new Set(todayMovs.map(m => m.desvio_objetivo).filter(Boolean))].join(' · ');

    return { linha: { nome: label, hc: rd.hc, sinal: '+' }, pastWeekly, pastAccReal, pastAccPlan: 0, dailyCells, weekReal, weekPlan: 0, todayReal, todayPlan: 0, todayProduto, todayCausas };
  });

  const pastWeeklyTot = pastWeeks.map((_, i) => ({ real: rows.reduce((s,r) => s + r.pastWeekly[i].real, 0), plano: 0 }));
  const dailyTot = days.map((_, i) => ({ real: rows.reduce((s,r) => s + r.dailyCells[i].real, 0), plano: 0 }));
  const pastAccRealTot = rows.reduce((s,r) => s + r.pastAccReal, 0);
  const weekRealTot = rows.reduce((s,r) => s + r.weekReal, 0);
  const todayRealTot = rows.reduce((s,r) => s + r.todayReal, 0);
  const totalHC = rows.reduce((s,r) => s + (r.linha.hc || 0), 0);

  el.innerHTML = buildTable({
    rows, pastWeeks, days, dayIso,
    pastWeeklyTot, dailyTot,
    pastAccRealTot, pastAccPlanTot: 0, weekRealTot, weekPlanTot: 0, todayRealTot, todayPlanTot: 0,
    totalHC, totalLabel: 'Total PSY', unit: 'paletes', fmt: v => v ? v.toLocaleString('pt-PT') : '—', fmtPlan: () => '—', noPlan: true,
  });
}

// ========================================================
// Shared table builder — 3 blocks side by side
// ========================================================
// Global state for dashboard UI
let pastCollapsed = true; // minimizado por defeito

function buildTable({
  rows, pastWeeks, days, dayIso,
  pastWeeklyTot, dailyTot,
  pastAccRealTot, pastAccPlanTot, weekRealTot, weekPlanTot, todayRealTot, todayPlanTot,
  totalHC, totalLabel, unit, fmt, fmtPlan, noPlan,
}) {
  const todayLabel = new Date(dayIso + 'T00:00:00Z').toLocaleDateString('pt-PT');
  // Top 3 paragens from localStorage (per empresa) — future: move to DB
  const paragensKey = 'mcfpsy-top3-paragens-' + (totalLabel.includes('MCF') ? 'mcf' : 'psy');
  const paragens = JSON.parse(localStorage.getItem(paragensKey) || '["","",""]');

  const pctCell = (real, plan) => {
    if (noPlan || !plan) return `<td style="padding:8px;text-align:right;border-bottom:1px solid #f0f0f3;color:#6e6e73">—</td>`;
    const p = real / plan * 100;
    return `<td style="padding:8px;text-align:right;border-bottom:1px solid #f0f0f3;color:${pctColor(p)};font-weight:700;${pctBg(p)}">${p.toFixed(0)}%</td>`;
  };
  const pctCellTot = (real, plan) => {
    if (noPlan || !plan) return `<td style="padding:10px;text-align:right;border-top:2px solid var(--color-blue)">—</td>`;
    const p = real / plan * 100;
    return `<td style="padding:10px;text-align:right;border-top:2px solid var(--color-blue);color:${pctColor(p)};${pctBg(p)}">${p.toFixed(0)}%</td>`;
  };

  // Value cell (no coloring — only % cells get colored)
  const valCell = (cell, extraStyle = '') => {
    if (!cell) return `<td style="${tdStyle};${extraStyle};color:#6e6e73">—</td>`;
    const real = cell.real || 0;
    return `<td style="${tdStyle};${extraStyle}">${fmt(real)}</td>`;
  };
  const valCellTot = (cell, extraStyle = '') => {
    if (!cell) return `<td style="${tdStyleTot};${extraStyle};color:#6e6e73">—</td>`;
    const real = cell.real || 0;
    return `<td style="${tdStyleTot};${extraStyle}">${fmt(real)}</td>`;
  };

  const thStyleData = 'text-align:right;padding:6px;border-bottom:2px solid #e0e0e0;font-size:.8rem;font-weight:600';
  const thStyleGroup = 'text-align:center;padding:6px;border-bottom:1px solid #e0e0e0;font-size:.75rem;color:#495057;font-weight:600;';
  const tdStyle = 'padding:8px;text-align:right;border-bottom:1px solid #f0f0f3;font-size:.85rem';
  const tdStyleTot = 'padding:10px;text-align:right;border-top:2px solid rgba(0,122,255,0.3);font-size:.9rem';

  // Block 1: Past weeks (7 cols) + Acumulado (Plano, Real, %)
  // Block 2: Days of current week (7 cols) + Total plano + Total real + %
  // Block 3: Today (Plano + Real + %)

  const block1FullCols = pastWeeks.length + (noPlan ? 1 : 3);
  const block1Cols = pastCollapsed ? 1 : block1FullCols; // 1 narrow col when collapsed
  const block2Cols = days.length + (noPlan ? 1 : 3);
  const block3Cols = noPlan ? 1 : 3;
  const block4Cols = 1; // Produto
  const block5Cols = 1; // Causas raíz

  const gap = `<td style="padding:0;width:18px;background:#fff;border-bottom:none" class="gap-col"></td>`;
  const gapHeadRow2 = `<th style="padding:0;width:18px;background:#fff;border-bottom:none"></th>`;
  const gapHeadTop = `<th style="padding:0;width:18px;background:#fff;border-bottom:none;border-top:none"></th>`;

  const collapseBtn = `<button type="button" id="togglePastBtn" style="background:rgba(255,255,255,0.25);border:none;color:#fff;cursor:pointer;font-size:1rem;padding:0;border-radius:4px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-weight:700" title="${pastCollapsed ? 'Expandir últimas semanas' : 'Minimizar'}">${pastCollapsed ? '+' : '−'}</button>`;

  return `
    <div style="display:flex;gap:16px;align-items:flex-start">
    <div style="flex:1;overflow-x:auto;min-width:0">
      <table style="width:100%;border-collapse:collapse;min-width:${pastCollapsed ? 1100 : 1500}px;font-size:.85rem">
        <thead>
          <tr>
            <th rowspan="3" style="text-align:left;padding:10px;border-bottom:2px solid #e0e0e0;background:#f5f5f7;position:sticky;left:0;z-index:2">Linha</th>
            <th rowspan="3" style="text-align:center;padding:10px;border-bottom:2px solid #e0e0e0;background:#f5f5f7">HC</th>
            ${gapHeadTop}
            <th colspan="${block1Cols}" style="${thStyleGroup}background:transparent">${pastCollapsed ? collapseBtn : `Últimas ${pastWeeks.length} semanas ${collapseBtn}`}</th>
            ${gapHeadTop}
            <th colspan="${block2Cols}" style="${thStyleGroup}background:transparent">Semana atual</th>
            ${gapHeadTop}
            <th colspan="${block3Cols}" style="${thStyleGroup}background:transparent">Hoje (${todayLabel})</th>
            ${gapHeadTop}
            <th colspan="${block4Cols}" style="${thStyleGroup}background:transparent">Produto</th>
            ${gapHeadTop}
            <th colspan="${block5Cols}" style="${thStyleGroup}background:rgba(245,127,23,0.15)">Causas raíz</th>
          </tr>
          <tr style="background:#f5f5f7">
            ${gapHeadRow2}
            ${pastCollapsed ? `<th style="${thStyleData};background:#f5f5f7">&nbsp;</th>` : `
              ${pastWeeks.map(w => `<th style="${thStyleData}color:#6e6e73">${w.label}</th>`).join('')}
              ${noPlan ? '' : `<th style="${thStyleData}background:transparent">Plano</th>`}
              <th style="${thStyleData}background:transparent">Real</th>
              ${noPlan ? '' : `<th style="${thStyleData}background:transparent">%</th>`}
            `}

            ${gapHeadRow2}
            ${days.map(d => `<th style="${thStyleData}">${d.label}<div style="font-size:.65rem;color:#6e6e73;font-weight:400">${d.dayNum}</div></th>`).join('')}
            ${noPlan ? '' : `<th style="${thStyleData}background:transparent">Plano</th>`}
            <th style="${thStyleData}background:transparent">Real</th>
            ${noPlan ? '' : `<th style="${thStyleData}background:transparent">%</th>`}

            ${gapHeadRow2}
            ${noPlan ? '' : `<th style="${thStyleData}background:transparent">Plano</th>`}
            <th style="${thStyleData}background:transparent">Real</th>
            ${noPlan ? '' : `<th style="${thStyleData}background:transparent">%</th>`}

            ${gapHeadRow2}
            <th style="${thStyleData}text-align:left">Produto</th>
            ${gapHeadRow2}
            <th style="${thStyleData}background:rgba(245,127,23,0.06);text-align:left">Desvio</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td style="padding:8px;border-bottom:1px solid #f0f0f3;position:sticky;left:0;background:#fff;z-index:1">${r.linha.nome}</td>
            <td style="padding:8px;text-align:center;border-bottom:1px solid #f0f0f3">
              ${(window.__editMode === true)
                ? `<input type="number" min="0" value="${r.linha.hc || 0}" data-hc-linha="${r.linha.nome}" data-hc-empresa="${totalLabel.includes('MCF') ? 'mcf' : 'psy'}" style="width:50px;padding:4px;border:1px solid var(--color-blue);border-radius:4px;text-align:center;font-weight:600">`
                : (r.linha.hc || 0)}
            </td>

            ${gap}
            ${pastCollapsed ? `<td style="${tdStyle};background:#f5f5f7;text-align:center;color:#adb5bd">···</td>` : `
              ${r.pastWeekly.map(c => valCell(c)).join('')}
              ${noPlan ? '' : `<td style="${tdStyle};background:transparent">${fmtPlan(r.pastAccPlan)}</td>`}
              ${valCell({ real: r.pastAccReal, plano: r.pastAccPlan }, 'background:transparent;font-weight:600')}
              ${noPlan ? '' : pctCell(r.pastAccReal, r.pastAccPlan)}
            `}

            ${gap}
            ${r.dailyCells.map((c,i) => valCell(c)).join('')}
            ${noPlan ? '' : `<td style="${tdStyle};background:transparent">${fmtPlan(r.weekPlan)}</td>`}
            ${valCell({ real: r.weekReal, plano: r.weekPlan }, 'background:transparent;font-weight:600')}
            ${noPlan ? '' : pctCell(r.weekReal, r.weekPlan)}

            ${gap}
            ${noPlan ? '' : `<td style="${tdStyle};background:transparent">${fmtPlan(r.todayPlan)}</td>`}
            ${valCell({ real: r.todayReal, plano: r.todayPlan }, 'background:transparent;font-weight:600')}
            ${noPlan ? '' : pctCell(r.todayReal, r.todayPlan)}

            ${gap}
            <td style="${tdStyle};text-align:left;font-size:.8rem;color:#495057">${r.todayProduto || '—'}</td>
            ${gap}
            <td style="${tdStyle};text-align:left;font-size:.78rem;color:#1d1d1f;max-width:260px;white-space:normal" title="${(r.todayCausas || '').replace(/"/g,'&quot;')}">${r.todayCausas || '—'}</td>
          </tr>`).join('')}
          <tr style="background:#e3eeff;font-weight:700">
            <td style="padding:10px;border-top:2px solid var(--color-blue);position:sticky;left:0;background:#e3eeff;z-index:1">${totalLabel}</td>
            <td style="padding:10px;text-align:center;border-top:2px solid var(--color-blue)">${totalHC}</td>

            <td style="padding:0;width:18px;background:#fff;border-top:none"></td>
            ${pastCollapsed ? `<td style="${tdStyleTot};text-align:center;color:#adb5bd">···</td>` : `
              ${pastWeeklyTot.map(c => valCellTot(c)).join('')}
              ${noPlan ? '' : `<td style="${tdStyleTot}">${fmtPlan(pastAccPlanTot)}</td>`}
              ${valCellTot({ real: pastAccRealTot, plano: pastAccPlanTot })}
              ${noPlan ? '' : pctCellTot(pastAccRealTot, pastAccPlanTot)}
            `}

            <td style="padding:0;width:18px;background:#fff;border-top:none"></td>
            ${dailyTot.map((c,i) => valCellTot(c)).join('')}
            ${noPlan ? '' : `<td style="${tdStyleTot}">${fmtPlan(weekPlanTot)}</td>`}
            ${valCellTot({ real: weekRealTot, plano: weekPlanTot })}
            ${noPlan ? '' : pctCellTot(weekRealTot, weekPlanTot)}

            <td style="padding:0;width:18px;background:#fff;border-top:none"></td>
            ${noPlan ? '' : `<td style="${tdStyleTot}">${fmtPlan(todayPlanTot)}</td>`}
            ${valCellTot({ real: todayRealTot, plano: todayPlanTot })}
            ${noPlan ? '' : pctCellTot(todayRealTot, todayPlanTot)}

            <td style="padding:0;width:18px;background:#fff;border-top:none"></td>
            <td style="${tdStyleTot}"></td>
            <td style="padding:0;width:18px;background:#fff;border-top:none"></td>
            <td style="${tdStyleTot}"></td>
          </tr>
        </tbody>
      </table>
    </div>
      <div style="width:240px;flex-shrink:0;display:flex;flex-direction:column;align-self:stretch">
        <h3 style="font-size:.78rem;margin:0 0 10px 0;color:#f57f17;text-align:center;font-weight:700;padding:8px;background:rgba(245,127,23,0.1);border-radius:8px;line-height:1.3">🚨 TOP 3<br>CAUSAS PARAGENS</h3>
        <div id="top3Paragens" style="flex:1;display:flex;flex-direction:column;gap:10px">
          ${[0,1,2].map(i => `
            <div style="flex:1;padding:12px;background:rgba(245,127,23,0.06);border-radius:8px;font-size:.82rem;display:flex;align-items:center">
              ${(window.__editMode === true)
                ? `<input type="text" value="${(paragens[i] || '').replace(/"/g,'&quot;')}" data-paragem-idx="${i}" data-paragem-key="${paragensKey}" placeholder="Causa ${i+1}..." style="width:100%;padding:6px 8px;border:1px solid rgba(245,127,23,0.3);border-radius:4px;font-size:.82rem;background:#fff">`
                : `<span>${paragens[i] || '<span style="color:#999">—</span>'}</span>`}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <p class="sub" style="margin-top:12px">Unidade: ${unit}. Cinza = últimas semanas · Azul = semana atual · Laranja = hoje. "Causas raíz" vem do campo "Desvio ao objetivo" dos registos. "—" sem dados.</p>
  `;
}
