import { supabase } from '../supabase.js';
import { renderMalotes } from './tabs/malotes.js';
import { renderTransfer } from './tabs/transfer.js';
import { renderInventario } from './tabs/inventario.js';
import { renderMovimentos } from './tabs/movimentos.js';
import { renderPedidos, countPedidosPendentes } from './tabs/pedidos.js';
import { renderDuvidas, countDuvidas } from './tabs/duvidas.js';
import { renderAjustes } from './tabs/ajustes.js';
import { renderPSY } from './tabs/psy.js';
import { renderMain } from './tabs/main.js';
import { canViewTab } from '../permissions.js';
import { getPendingCount, sync } from '../offline.js';

const TABS = [
  { id: 'main',       label: 'Dashboard',             icon: '📈', render: renderMain },
  { id: 'malotes',    label: 'Registos Produção MCF', icon: '📦', render: renderMalotes },
  { id: 'psy',        label: 'Registos Produção PSY', icon: '🏭', render: renderPSY },
  { id: 'transfer',   label: 'Transferências',   icon: '🔄', render: renderTransfer },
  { id: 'inventario', label: 'Inventário',        icon: '📊', render: renderInventario },
  { id: 'movimentos', label: 'Movimentos',        icon: '📅', render: renderMovimentos },
  { id: 'pedidos',    label: 'Pedidos',           icon: '📋', render: renderPedidos },
  { id: 'duvidas',    label: 'Dúvidas',           icon: '❓', render: renderDuvidas },
  { id: 'ajustes',    label: 'Ajustes',           icon: '⚙️', render: renderAjustes },
];

let currentTab = 'main';
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
          ${profile.perfil === 'admin' ? `<button id="settingsBtn" title="Definições" style="background:transparent;border:none;font-size:1.3rem;cursor:pointer;padding:4px 8px">⚙️</button>` : ''}
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

  const settingsBtn = root.querySelector('#settingsBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
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

// ============================================
// Settings modal (admin only) — manage per-user tab permissions
// ============================================
async function openSettingsModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:700px;max-height:85vh;overflow-y:auto">
      <h3>⚙️ Gestão de permissões</h3>
      <p class="sub">Define por utilizador que tabs pode ver e em quais pode escrever. Se nada estiver definido, aplicam-se as permissões do perfil (operador, admin_producao, etc.).</p>
      <div id="settingsContent"><p class="sub">A carregar...</p></div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="closeSettings">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#closeSettings').onclick = () => modal.remove();

  // Load users + existing permissions
  const [usersRes, permsRes] = await Promise.all([
    supabase.from('profiles').select('id, nome, perfil').order('nome'),
    supabase.from('user_tab_permissions').select('*'),
  ]);

  const users = usersRes.data || [];
  const perms = new Map();
  for (const p of (permsRes.data || [])) perms.set(p.user_id, p);

  const allTabs = TABS.map(t => ({ id: t.id, label: t.label }));
  const content = modal.querySelector('#settingsContent');

  content.innerHTML = users.map(u => {
    const p = perms.get(u.id) || { tabs: null, write_tabs: null };
    const hasCustom = p.tabs !== null;
    return `
      <div style="border:1px solid var(--color-border);border-radius:10px;padding:12px;margin-bottom:12px" data-user-id="${u.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b>${u.nome}</b>
          <span style="font-size:.75rem;color:#6e6e73">${u.perfil}${hasCustom ? ' · <b style="color:#007AFF">permissões custom</b>' : ''}</span>
        </div>
        <table style="width:100%;font-size:.85rem">
          <thead><tr><th style="text-align:left;padding:4px">Tab</th><th style="text-align:center;padding:4px">Ver</th><th style="text-align:center;padding:4px">Escrever</th></tr></thead>
          <tbody>
            ${allTabs.map(t => {
              const view = p.tabs ? (p.tabs.includes(t.id)) : null;
              const write = p.write_tabs ? (p.write_tabs.includes(t.id)) : null;
              return `<tr>
                <td style="padding:4px">${t.label}</td>
                <td style="text-align:center;padding:4px"><input type="checkbox" data-view="${t.id}" ${view ? 'checked' : ''}></td>
                <td style="text-align:center;padding:4px"><input type="checkbox" data-write="${t.id}" ${write ? 'checked' : ''}></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-primary" style="padding:6px 14px;font-size:.8rem" data-action="save">💾 Gravar</button>
          <button class="btn btn-secondary" style="padding:6px 14px;font-size:.8rem" data-action="reset">Reset (usar perfil)</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind save/reset
  content.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-user-id]');
      const userId = card.dataset.userId;
      if (btn.dataset.action === 'reset') {
        const { error } = await supabase.from('user_tab_permissions').delete().eq('user_id', userId);
        if (error) return toast('Erro: ' + error.message, 'error');
        toast('✓ Reset feito', 'success');
        modal.remove(); openSettingsModal();
        return;
      }
      const tabs = [...card.querySelectorAll('[data-view]:checked')].map(c => c.dataset.view);
      const writeTabs = [...card.querySelectorAll('[data-write]:checked')].map(c => c.dataset.write);
      const { error } = await supabase.from('user_tab_permissions').upsert({
        user_id: userId, tabs, write_tabs: writeTabs, atualizado_em: new Date().toISOString(),
      });
      if (error) return toast('Erro: ' + error.message, 'error');
      toast('✓ Permissões gravadas', 'success');
    });
  });
}
