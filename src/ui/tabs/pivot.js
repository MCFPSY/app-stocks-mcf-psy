// Tab "Análise (Pivot)" — PivotTable.js com drag & drop à Excel
// - Fetch movimentos + enrich com campos computados
// - Render via pivotUI() com renderer padrão = Table
// - Layout guarda-se em localStorage

import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

// jQuery + jQuery UI + PivotTable.js
import jQuery from 'jquery';
window.$ = window.jQuery = jQuery;
import 'jquery-ui-dist/jquery-ui.js';
import 'pivottable/dist/pivot.css';
import 'pivottable/dist/pivot.js';
import 'pivottable/dist/pivot.pt.js';

const LAYOUT_KEY = 'mcfpsy-pivot-layout';

// ========================================================
// Helpers
// ========================================================
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { year: date.getUTCFullYear(), week: Math.ceil(((date - yearStart) / 86400000 + 1) / 7) };
}

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function groupOfLinha(nome) {
  if (!nome) return 'outros';
  if (nome.startsWith('Linha principal') || nome.startsWith('[+] Madeira de 2ª T')) return 'Principal';
  if (nome.includes('charriot')) return 'Charriot';
  if (nome.startsWith('Linha aproveitamentos') || nome.startsWith('[+] Madeira de 2ª Aprov')) return 'Aproveitamentos';
  if (nome.startsWith('[-]')) return 'Retestagem';
  return 'Outros';
}

// ========================================================
// Render
// ========================================================
export async function renderPivot(el, ctx) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:10px">
        <h2 style="margin:0">📊 Análise (Pivot)</h2>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label style="font-size:.85rem;color:#666">De</label>
          <input type="date" id="pvFrom" style="padding:6px 10px;border:2px solid var(--color-border);border-radius:8px;font-size:.88rem">
          <label style="font-size:.85rem;color:#666">até</label>
          <input type="date" id="pvTo" style="padding:6px 10px;border:2px solid var(--color-border);border-radius:8px;font-size:.88rem">
          <select id="pvEmpresa" style="padding:6px 10px;border:2px solid var(--color-border);border-radius:8px;font-size:.88rem">
            <option value="">Ambas</option>
            <option value="MCF" selected>MCF</option>
            <option value="PSY">PSY</option>
          </select>
          <button id="pvReload" style="padding:6px 14px;background:var(--color-blue);color:#fff;border:none;border-radius:8px;font-size:.85rem;cursor:pointer;font-weight:600">↻ Recarregar</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="pvExportCsv" style="padding:5px 12px;background:#fff;border:1px solid var(--color-border);border-radius:6px;font-size:.78rem;cursor:pointer">📥 Export CSV</button>
        <button id="pvSaveLayout" style="padding:5px 12px;background:#fff;border:1px solid var(--color-border);border-radius:6px;font-size:.78rem;cursor:pointer">💾 Guardar layout</button>
        <button id="pvResetLayout" style="padding:5px 12px;background:#fff;border:1px solid var(--color-border);border-radius:6px;font-size:.78rem;cursor:pointer">🗑 Reset layout</button>
        <span id="pvStatus" style="font-size:.78rem;color:#888;align-self:center">A carregar...</span>
      </div>
    </div>

    <div class="card" style="padding:8px;overflow:auto">
      <div id="pvContainer" style="min-height:400px"></div>
    </div>
  `;

  // Defaults: últimos 30 dias
  const today = new Date();
  const from = new Date(today); from.setDate(today.getDate() - 30);
  el.querySelector('#pvFrom').value = from.toISOString().slice(0, 10);
  el.querySelector('#pvTo').value = today.toISOString().slice(0, 10);

  async function loadAndRender() {
    const status = el.querySelector('#pvStatus');
    status.textContent = 'A carregar...';
    status.style.color = '#888';

    const fromIso = el.querySelector('#pvFrom').value;
    const toIso = el.querySelector('#pvTo').value;
    const empresa = el.querySelector('#pvEmpresa').value;

    let movQuery = supabase.from('movimentos')
      .select('linha, turno, data_registo, criado_em, produto_stock, m3, malotes, pecas_por_malote, total_pecas, tipo, empresa, operador_id')
      .eq('tipo', 'entrada_producao')
      .eq('estornado', false)
      .eq('duvida_resolvida', true)
      .gte('data_registo', fromIso)
      .lte('data_registo', toIso)
      .limit(50000);
    if (empresa) movQuery = movQuery.eq('empresa', empresa);

    const [movsRes, mpRes, linhasRes, configRes, profilesRes] = await Promise.all([
      movQuery,
      supabase.from('mp_standard').select('produto_stock, comprimento, largura, espessura, categoria'),
      supabase.from('mcf_linhas').select('nome, tipo_benchmark, sinal, categoria'),
      supabase.from('consumo_config').select('chave, valor').eq('chave', 'ratio_ton_m3').maybeSingle(),
      supabase.from('profiles').select('id, nome'),
    ]);

    if (movsRes.error) { status.textContent = `Erro: ${movsRes.error.message}`; status.style.color = '#c0392b'; return; }

    const ratio = configRes.data ? Number(configRes.data.valor) : 2.129925;
    const mpMap = Object.fromEntries((mpRes.data || []).map(p => [p.produto_stock, p]));
    const linhaMap = Object.fromEntries((linhasRes.data || []).map(l => [l.nome, l]));
    const opMap = Object.fromEntries((profilesRes.data || []).map(p => [p.id, p.nome]));

    // Enriquecer cada movimento com campos computados
    const rows = (movsRes.data || []).map(m => {
      const d = m.data_registo || (m.criado_em ? m.criado_em.slice(0, 10) : '');
      const dateObj = d ? new Date(d + 'T00:00:00Z') : null;
      const { year, week } = dateObj ? isoWeek(dateObj) : { year: null, week: null };
      const mes = dateObj ? dateObj.getUTCMonth() : null;
      const dia_semana = dateObj ? dateObj.getUTCDay() : null;
      const p = mpMap[m.produto_stock];
      const linha = linhaMap[m.linha];

      return {
        data: d || '',
        ano: year || '',
        mes: mes != null ? MESES[mes] : '',
        semana: week ? `W${String(week).padStart(2, '0')}` : '',
        dia_semana: dia_semana != null ? DIAS[dia_semana] : '',
        turno: m.turno || '',
        empresa: m.empresa || '',
        linha: m.linha || '',
        grupo: groupOfLinha(m.linha),
        tipo_benchmark: linha?.tipo_benchmark || '',
        sinal: linha?.sinal || '',
        produto: m.produto_stock || '',
        categoria: p?.categoria || linha?.categoria || '',
        comprimento: p?.comprimento || '',
        largura: p?.largura || '',
        espessura: p?.espessura || '',
        cross_section: p ? `${p.largura}x${p.espessura}` : '',
        operador: opMap[m.operador_id] || '',
        m3: Number(m.m3) || 0,
        tons: +((Number(m.m3) || 0) * ratio).toFixed(3),
        malotes: Number(m.malotes) || 0,
        pecas_por_malote: Number(m.pecas_por_malote) || 0,
        total_pecas: Number(m.total_pecas) || 0,
      };
    });

    status.textContent = `${rows.length} registos carregados`;
    status.style.color = rows.length > 0 ? '#198754' : '#c0392b';

    // Layout: carregar do localStorage se existir
    const saved = (() => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch { return null; } })();

    const $container = window.jQuery(el.querySelector('#pvContainer'));
    $container.empty();
    $container.pivotUI(rows, Object.assign({
      rows: ['grupo', 'linha'],
      cols: ['turno'],
      vals: ['m3'],
      aggregatorName: 'Soma',
      rendererName: 'Tabela',
      unusedAttrsVertical: false,
      // Não mostrar campos internos nem redundantes por defeito na lista
    }, saved || {}));

    // Export CSV helper
    el.querySelector('#pvExportCsv').onclick = () => {
      const table = el.querySelector('#pvContainer table.pvtTable');
      if (!table) { toast('Nada para exportar', 'error'); return; }
      const lines = [];
      for (const tr of table.querySelectorAll('tr')) {
        const cells = [...tr.querySelectorAll('th, td')].map(c => `"${(c.innerText || '').replace(/"/g, '""')}"`);
        lines.push(cells.join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pivot_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    // Guardar/reset layout
    el.querySelector('#pvSaveLayout').onclick = () => {
      const cfg = $container.data('pivotUIOptions');
      if (!cfg) { toast('Sem layout', 'error'); return; }
      const toSave = {
        rows: cfg.rows,
        cols: cfg.cols,
        vals: cfg.vals,
        aggregatorName: cfg.aggregatorName,
        rendererName: cfg.rendererName,
        inclusions: cfg.inclusions,
        exclusions: cfg.exclusions,
      };
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(toSave));
      toast('Layout guardado', 'success');
    };
    el.querySelector('#pvResetLayout').onclick = () => {
      localStorage.removeItem(LAYOUT_KEY);
      toast('Layout apagado', 'success');
      loadAndRender();
    };
  }

  el.querySelector('#pvReload').addEventListener('click', loadAndRender);
  el.querySelector('#pvFrom').addEventListener('change', loadAndRender);
  el.querySelector('#pvTo').addEventListener('change', loadAndRender);
  el.querySelector('#pvEmpresa').addEventListener('change', loadAndRender);

  await loadAndRender();
}
