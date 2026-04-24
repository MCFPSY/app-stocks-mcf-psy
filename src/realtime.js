// Realtime via Supabase (postgres_changes).
// Substituí o reload de 60 em 60 segundos — eventos chegam push quando há mudanças
// nas tabelas relevantes. onChange é chamado com (table, payload) sempre que algo muda.

import { supabase } from './supabase.js';

let channels = [];
let debounceTimer = null;

/**
 * Inscreve-se em INSERT/UPDATE/DELETE das tabelas dadas.
 * onChange é chamado com (table, payload) — faz debounce de 400ms para evitar bursts.
 */
export function startRealtime({ tables, onChange, debounceMs = 400 } = {}) {
  stopRealtime();
  const tableList = tables || ['movimentos', 'pedidos'];
  let pending = new Set();

  function trigger(table, payload) {
    pending.add(table);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const tables = [...pending];
      pending = new Set();
      for (const t of tables) onChange(t, payload);
    }, debounceMs);
  }

  for (const table of tableList) {
    const ch = supabase.channel(`realtime_${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
        trigger(table, payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log(`[realtime] subscribed ${table}`);
        else if (status === 'CHANNEL_ERROR') console.warn(`[realtime] error ${table}`);
      });
    channels.push(ch);
  }
}

export function stopRealtime() {
  clearTimeout(debounceTimer); debounceTimer = null;
  for (const ch of channels) {
    try { supabase.removeChannel(ch); } catch {}
  }
  channels = [];
}
