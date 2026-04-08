import { supabase } from '../../supabase.js';
import { toast } from '../app.js';
import * as XLSX from 'xlsx';

let mpCache = null;
async function loadMP() {
  if (mpCache) return mpCache;
  const { data } = await supabase.from('mp_standard').select('*').eq('ativo',true).order('produto_stock');
  mpCache = data || []; return mpCache;
}

export async function renderAjustes(el, ctx) {
  if (!['admin','admin_producao'].includes(ctx.profile.perfil)) {
    el.innerHTML = `<div class="card"><h2>⚙️ Ajustes</h2><p class="sub">Acesso restrito a administradores.</p></div>`;
    return;
  }
  const mp = await loadMP();
  const prods = [...new Set(mp.map(x=>x.produto_stock))];

  el.innerHTML = `
    <div class="card">
      <h2>⚙️ Ajustes de Stock</h2>
      <p class="sub">Entradas externas (fornecedores) e correções. Cada ajuste fica rastreado com autor, data e justificação.</p>
      <form id="fA">
        <div class="form-grid">
          <div class="field"><label>Empresa</label><select class="big" id="emp"><option>MCF</option><option>PSY</option></select></div>
          <div class="field"><label>Tipo de ajuste</label>
            <select class="big" id="tipo">
              <option value="ajuste_entrada">Entrada externa (fornecedor)</option>
              <option value="ajuste_entrada_corr">Correção positiva</option>
              <option value="ajuste_saida">Correção negativa</option>
            </select>
          </div>
          <div class="field" id="fornBox"><label>Fornecedor</label>
            <select class="big" id="forn"><option>Serbul</option><option>Lamelas</option><option>FiliCoelho</option><option>DRA</option></select>
          </div>
          <div class="field"><label>Produto</label>
            <select class="big" id="prod">${prods.map(p=>`<option>${p}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Malotes</label><input class="big" id="mal" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label>Justificação</label><input class="big" id="just" placeholder="ex: receção fatura #12345"></div>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary btn-big">✓ Aplicar ajuste</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>📊 Inventário semestral (.xlsx)</h2>
      <p class="sub">Exporta o stock atual para contagem em papel. Depois importa o ficheiro corrigido e aplica como inventário novo (substitui stock).</p>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-secondary btn-big" id="btnExp">📥 Exportar inventário (.xlsx)</button>
        <label class="btn btn-secondary btn-big" style="cursor:pointer;margin:0">
          📤 Importar inventário
          <input type="file" id="impFile" accept=".xlsx,.xls" style="display:none">
        </label>
      </div>
      <div id="impPreview"></div>
    </div>
  `;
  // Export
  el.querySelector('#btnExp').onclick = async () => {
    const { data } = await supabase.from('v_stock').select('*').order('produto_stock');
    const rows = [['Produto','Empresa','Malotes','m3','Malotes_contados','Observacoes']];
    (data||[]).forEach(r => rows.push([r.produto_stock, r.empresa, Number(r.malotes||0), Number(r.m3||0), '', '']));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:22},{wch:10},{wch:12},{wch:10},{wch:18},{wch:30}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const dt = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `inventario_${dt}.xlsx`);
    toast('✓ Exportado','success');
  };
  // Import
  el.querySelector('#impFile').onchange = async (ev) => {
    const file = ev.target.files[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    // Esperado: Produto, Empresa, Malotes_contados
    const diffs = [];
    for (const r of rows) {
      const prod = r.Produto || r.produto;
      const emp = r.Empresa || r.empresa;
      const cnt = parseFloat(r.Malotes_contados || r.malotes_contados);
      if (!prod || !emp || isNaN(cnt)) continue;
      diffs.push({ produto: String(prod).trim(), empresa: String(emp).trim().toUpperCase(), malotes_contados: cnt });
    }
    el.querySelector('#impPreview').innerHTML = `
      <div style="margin-top:16px;padding:16px;background:#fff3e0;border-radius:12px">
        <h3>⚠️ Pré-visualização da importação</h3>
        <p>${diffs.length} linhas válidas. Vai criar um movimento tipo <b>inventário</b> para cada.</p>
        <div style="max-height:300px;overflow:auto;margin:10px 0;background:#fff;border-radius:8px;padding:10px">
          <table style="width:100%;font-size:.85rem"><thead><tr><th style="text-align:left">Produto</th><th>Empresa</th><th>Malotes</th></tr></thead>
          <tbody>${diffs.slice(0,20).map(d=>`<tr><td>${d.produto}</td><td>${d.empresa}</td><td style="text-align:right">${d.malotes_contados}</td></tr>`).join('')}</tbody></table>
          ${diffs.length>20?`<p style="color:#888">... e mais ${diffs.length-20} linhas</p>`:''}
        </div>
        <button class="btn btn-danger" id="confirmImp">⚠️ Aplicar inventário (substitui stock)</button>
      </div>
    `;
    el.querySelector('#confirmImp').onclick = async () => {
      if (!confirm(`Aplicar ${diffs.length} linhas como inventário? Esta operação cria movimentos novos e não reverte os anteriores automaticamente.`)) return;
      const mp = await loadMP();
      const batch = diffs.map(d => {
        const p = mp.find(x => x.produto_stock === d.produto);
        const pm = p?.pecas_por_malote || 0;
        const m3 = p ? (p.comprimento/1000)*(p.largura/1000)*(p.espessura/1000)*pm*d.malotes_contados : 0;
        return {
          tipo:'inventario', empresa:d.empresa, produto_stock:d.produto,
          malotes:d.malotes_contados, pecas_por_malote:pm, m3:+m3.toFixed(4),
          operador_id:ctx.profile.id, justificacao:'Inventário semestral importado '+new Date().toISOString().slice(0,10),
        };
      });
      const { error } = await supabase.from('movimentos').insert(batch);
      if (error) return toast('Erro: '+error.message,'error');
      toast(`✓ ${batch.length} linhas aplicadas`,'success');
      el.querySelector('#impPreview').innerHTML = '';
    };
  };

  const $ = id => el.querySelector('#'+id);
  const tipoSel = $('tipo'), fornBox = $('fornBox');
  tipoSel.onchange = () => {
    fornBox.style.display = tipoSel.value === 'ajuste_entrada' ? '' : 'none';
  };

  $('fA').onsubmit = async (e) => {
    e.preventDefault();
    const prod = $('prod').value;
    const p = mp.find(x => x.produto_stock === prod);
    const mal = parseFloat($('mal').value);
    if (!mal || mal <= 0) return toast('Quantidade inválida','error');
    const tipoRaw = tipoSel.value;
    const tipo = tipoRaw === 'ajuste_saida' ? 'ajuste_saida' : 'ajuste_entrada';
    const vol1 = (p.comprimento/1000)*(p.largura/1000)*(p.espessura/1000);
    const m3v = +(vol1 * mal * p.pecas_por_malote).toFixed(4);
    if (!confirm(`Confirmar ${tipo} de ${mal} malotes de ${prod} na ${$('emp').value}?`)) return;
    const { error } = await supabase.from('movimentos').insert({
      tipo, empresa: $('emp').value, produto_stock: prod,
      malotes: mal, pecas_por_malote: p.pecas_por_malote, m3: m3v,
      fornecedor: tipoRaw==='ajuste_entrada' ? $('forn').value : null,
      justificacao: $('just').value || null,
      operador_id: ctx.profile.id,
    });
    if (error) return toast('Erro: '+error.message,'error');
    toast('✓ Ajuste aplicado','success');
    $('mal').value=''; $('just').value='';
  };
}
