import { supabase } from '../../supabase.js';
import { toast } from '../app.js';

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
  `;

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
