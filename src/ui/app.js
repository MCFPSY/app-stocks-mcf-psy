import { supabase } from '../supabase.js';
import { renderMalotes } from './tabs/malotes.js';
import { renderTransfer } from './tabs/transfer.js';
import { renderInventario } from './tabs/inventario.js';
import { renderMovimentos } from './tabs/movimentos.js';
import { renderPedidos, countPedidosPendentes } from './tabs/pedidos.js';
import { renderDuvidas, countDuvidas } from './tabs/duvidas.js';
import { renderAjustes } from './tabs/ajustes.js';

const TABS = [
  { id: 'malotes',    label: 'Malotes Produção', icon: '📦', render: renderMalotes },
  { id: 'transfer',   label: 'Transferências',   icon: '🔄', render: renderTransfer },
  { id: 'inventario', label: 'Inventário',        icon: '📊', render: renderInventario },
  { id: 'movimentos', label: 'Movimentos',        icon: '📅', render: renderMovimentos },
  { id: 'pedidos',    label: 'Pedidos',           icon: '📋', render: renderPedidos },
  { id: 'duvidas',    label: 'Dúvidas',           icon: '❓', render: renderDuvidas },
  { id: 'ajustes',    label: 'Ajustes',           icon: '⚙️', render: renderAjustes },
];

let currentTab = 'malotes';
let reloadTimer = null;

export function renderApp(root, profile) {
  root.innerHTML = `
    <header class="app-header">
      <div class="header-content">
        <h1><div class="logo">S</div> Stocks MCF + PSY</h1>
        <div class="header-right">
          <div class="sync-pill" id="syncPill"><span class="sync-dot"></span><span id="syncText">Sincronizado</span></div>
          <div class="user-chip" id="userChip"><div class="avatar">${profile.nome.slice(0,2).toUpperCase()}</div>${profile.nome} · ${profile.perfil}</div>
        </div>
      </div>
    </header>
    <main class="app-main">
      <nav class="tab-nav" id="tabNav"></nav>
      <section id="tabContent"></section>
    </main>
  `;
  drawNav(profile);
  root.querySelector('#tabNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    currentTab = btn.dataset.tab;
    drawNav(profile);
    renderCurrentTab(profile);
  });
  root.querySelector('#userChip').addEventListener('click', async () => {
    if (confirm('Terminar sessão?')) await supabase.auth.signOut();
  });
  renderCurrentTab(profile);
  refreshBadges();

  if (reloadTimer) clearInterval(reloadTimer);
  reloadTimer = setInterval(() => {
    const pill = document.getElementById('syncPill');
    const txt = document.getElementById('syncText');
    if (!pill) return;
    pill.classList.add('reloading');
    txt.textContent = 'A sincronizar...';
    setTimeout(() => {
      renderCurrentTab(profile);
      refreshBadges();
      pill.classList.remove('reloading');
      txt.textContent = 'Sincronizado';
    }, 800);
  }, 60000);
}

let badges = { pedidos: 0, duvidas: 0 };

async function refreshBadges() {
  try {
    badges.pedidos = await countPedidosPendentes();
    badges.duvidas = await countDuvidas();
    drawNav();
  } catch(e) { console.error(e); }
}

function drawNav(profile) {
  const nav = document.getElementById('tabNav');
  if (!nav) return;
  nav.innerHTML = TABS.map(t => {
    let badge = '';
    if (t.id === 'pedidos' && badges.pedidos) badge = `<span class="tab-badge">${badges.pedidos}</span>`;
    if (t.id === 'duvidas' && badges.duvidas) badge = `<span class="tab-badge">${badges.duvidas}</span>`;
    return `<button class="tab-btn ${t.id===currentTab?'active':''}" data-tab="${t.id}">
      ${t.icon} <span class="label">${t.label}</span>${badge}
    </button>`;
  }).join('');
}

function renderCurrentTab(profile) {
  const content = document.getElementById('tabContent');
  const tab = TABS.find(t => t.id === currentTab);
  tab.render(content, { profile });
}

export function toast(msg, type='') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
