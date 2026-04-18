// Permissões por perfil (fallback quando não há override custom)
// operador        → Malotes + Transferências (só escrita suas)
// contabilista    → Movimentos + Inventário (só leitura)
// admin_producao  → Tudo exceto Ajustes
// admin           → Tudo

import { supabase } from './supabase.js';

export const PERMS = {
  operador:       { tabs: ['malotes','psy','transfer','inventario','pedidos'], write: ['movimentos','pedidos','psy_producao'] },
  contabilista:   { tabs: ['main','inventario','movimentos','pedidos','consumo','pivot'],          write: ['contabilizacao','pedidos'] },
  admin_producao: { tabs: ['main','malotes','psy','transfer','inventario','movimentos','pedidos','duvidas','consumo','pivot'], write: ['movimentos','pedidos','duvidas','psy_producao'] },
  admin:          { tabs: ['main','malotes','psy','transfer','inventario','movimentos','pedidos','duvidas','consumo','pivot','ajustes'], write: ['*'] },
};

// Custom per-user permissions loaded from BD at login
let customPerms = null;

export async function loadCustomPerms(userId) {
  try {
    const { data } = await supabase.from('user_tab_permissions').select('*').eq('user_id', userId).maybeSingle();
    if (data) customPerms = { tabs: data.tabs || [], write: data.write_tabs || [] };
    else customPerms = null;
  } catch {
    customPerms = null;
  }
}

export function canViewTab(profile, tab) {
  if (customPerms) return customPerms.tabs.includes(tab);
  const p = PERMS[profile?.perfil]; if (!p) return false;
  return p.tabs.includes(tab);
}

export function canWrite(profile, what) {
  if (customPerms) return customPerms.write.includes('*') || customPerms.write.includes(what);
  const p = PERMS[profile?.perfil]; if (!p) return false;
  return p.write.includes('*') || p.write.includes(what);
}
