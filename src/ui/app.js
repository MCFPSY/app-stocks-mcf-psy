import { supabase } from '../supabase.js';
import { renderMalotes } from './tabs/malotes.js';
import { renderTransfer } from './tabs/transfer.js';
import { renderInventario } from './tabs/inventario.js';
import { renderMovimentos } from './tabs/movimentos.js';
import { renderPedidos, countPedidosPendentes } from './tabs/pedidos.js';
import { renderDuvidas, countDuvidas } from './tabs/duvidas.js';
import { renderAjustes } from './tabs/ajustes.js';
import { renderPSY } from './tabs/psy.js';
import { canViewTab } from '../permissions.js';
import { getPendingCount, sync } from '../offline.js';

const TABS = [
  { id: 'malotes',    label: 'Registos Produção MCF', icon: '📦', render: renderMalotes },
  { id: 'psy',        label: 'Registos Produção PSY', icon: '🏭', render: renderPSY },
  { id: 'transfer',   label: 'Transferências',   icon: '🔄', render: renderTransfer },
  { id: 'inventario', label: 'Inventário',        icon: '📊', render: renderInventario },
  { id: 'movimentos', label: 'Movimentos',        icon: '📅', render: renderMovimentos },
  { id: 'pedidos',    label: 'Pedidos',           icon: '📋', render: renderPedidos },
  { id: 'duvidas',    label: 'Dúvidas',           icon: '❓', render: renderDuvidas },
  { id: 'ajustes',    label: 'Ajustes',           icon: '⚙️', render: renderAjustes },
];

let currentTab = 'malotes';
let reloadTimer = null;
let badges = { pedidos: 0, duvidas: 0, pending: 0 };
let currentProfile = null;

export function renderApp(root, profile) {
  currentProfile = profile;
  // tab inicial: primeira permitida
  const allowed = TABS.filter(t => canViewTab(profile, t.id));
  if (!allowed.find(t => t.id === currentTab)) currentTab = allowed[0]?.id || 'malotes';

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
  drawNav();
  root.querySelector('#tabNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    currentTab = btn.dataset.tab;
    drawNav();
    renderCurrentTab();
  });
  root.querySelector('#userChip').addEventListener('click', async () => {
    if (confirm('Terminar sessão?')) await supabase.auth.signOut();
  });
  renderCurrentTab();
  refreshBadges();
  updateSyncPill();

  if (reloadTimer) clearInterval(reloadTimer);
  reloadTimer = setInterval(async () => {
    if (!navigator.onLine) { updateSyncPill(); return; }
    const pill = document.getElementById('syncPill');
    const txt = document.getElementById('syncText');
    if (!pill) return;
    pill.classList.add('reloading');
    txt.textContent = 'A sincronizar...';
    await sync();
    setTimeout(() => {
      renderCurrentTab();
      refreshBadges();
      updateSyncPill();
    }, 500);
  }, 60000);

  // listeners de rede
  window.addEventListener('online', updateSyncPill);
  window.addEventListener('offline', updateSyncPill);
  window.addEventListener('sync-done', () => { refreshBadges(); updateSyncPill(); });
}

async function updateSyncPill() {
  const pill = document.getElementById('syncPill');
  const txt = document.getElementById('syncText');
  if (!pill) return;
  badges.pending = await getPendingCount();
  pill.classList.remove('reloading');
  pill.classList.remove('offline');
  pill.classList.remove('queued');
  if (!navigator.onLine) {
    pill.classList.add('offline');
    txt.textContent = badges.pending ? `🔌 Offline · ${badges.pending} pendentes` : '🔌 Offline';
  } else if (badges.pending) {
    pill.classList.add('queued');
    txt.textContent = `📤 ${badges.pending} por sincronizar`;
  } else {
    txt.textContent = 'Sincronizado';
  }
}

async function refreshBadges() {
  try {
    if (navigator.onLine) {
      badges.pedidos = await countPedidosPendentes();
      badges.duvidas = await countDuvidas();
    }
    drawNav();
  } catch(e) { console.error(e); }
}

function drawNav() {
  const nav = document.getElementById('tabNav');
  if (!nav) return;
  const visible = TABS.filter(t => canViewTab(currentProfile, t.id));
  nav.innerHTML = visible.map(t => {
    let badge = '';
    if (t.id === 'pedidos' && badges.pedidos) badge = `<span class="tab-badge">${badges.pedidos}</span>`;
    if (t.id === 'duvidas' && badges.duvidas) badge = `<span class="tab-badge">${badges.duvidas}</span>`;
    return `<button class="tab-btn ${t.id===currentTab?'active':''}" data-tab="${t.id}">
      ${t.icon} <span class="label">${t.label}</span>${badge}
    </button>`;
  }).join('');
}

function renderCurrentTab() {
  const content = document.getElementById('tabContent');
  const tab = TABS.find(t => t.id === currentTab);
  if (!canViewTab(currentProfile, currentTab)) {
    content.innerHTML = `<div class="card"><h2>🔒 Sem permissão</h2><p class="sub">O teu perfil (${currentProfile.perfil}) não tem acesso a esta tab.</p></div>`;
    return;
  }
  tab.render(content, { profile: currentProfile });
}

export function toast(msg, type='') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
