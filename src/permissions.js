// Permissões por perfil
// operador        → Malotes + Transferências (só escrita suas)
// contabilista    → Movimentos + Inventário (só leitura)
// admin_producao  → Tudo exceto Ajustes
// admin           → Tudo

export const PERMS = {
  operador:       { tabs: ['malotes','transfer','inventario','pedidos'], write: ['movimentos','pedidos'] },
  contabilista:   { tabs: ['inventario','movimentos','pedidos'],          write: ['contabilizacao','pedidos'] },
  admin_producao: { tabs: ['malotes','transfer','inventario','movimentos','pedidos','duvidas'], write: ['movimentos','pedidos','duvidas'] },
  admin:          { tabs: ['malotes','transfer','inventario','movimentos','pedidos','duvidas','ajustes'], write: ['*'] },
};

export function canViewTab(profile, tab) {
  const p = PERMS[profile?.perfil]; if (!p) return false;
  return p.tabs.includes(tab);
}
export function canWrite(profile, what) {
  const p = PERMS[profile?.perfil]; if (!p) return false;
  return p.write.includes('*') || p.write.includes(what);
}
