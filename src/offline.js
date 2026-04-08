// Offline-first: fila local em IndexedDB + sincronização automática
// Operadores em tablets sem internet podem continuar a trabalhar.
//
// Fluxo:
// 1. Operador regista um movimento → grava em IndexedDB (sempre)
// 2. Se online → tenta enviar ao Supabase. Se OK, marca como sincronizado.
// 3. Se offline/erro → fica na fila. Sincroniza assim que voltar rede.
// 4. Tab Malotes/Transferências usa addMovimento() em vez de supabase.insert direto.

import { supabase } from './supabase.js';

const DB_NAME = 'stocks-offline';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('queue')) {
        const s = db.createObjectStore('queue', { keyPath: 'local_id', autoIncrement: true });
        s.createIndex('synced', 'synced');
        s.createIndex('table', 'table');
      }
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    const res = fn(store);
    tx.oncomplete = () => resolve(res);
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Fila de operações ----
export async function enqueue(table, op, payload) {
  return withStore('queue', 'readwrite', store => {
    return new Promise(resolve => {
      const req = store.add({
        table, op, payload,
        synced: 0,
        created_at: Date.now(),
      });
      req.onsuccess = () => resolve(req.result);
    });
  });
}

export async function getPendingCount() {
  return withStore('queue', 'readonly', store => {
    return new Promise(resolve => {
      const idx = store.index('synced');
      const req = idx.count(IDBKeyRange.only(0));
      req.onsuccess = () => resolve(req.result);
    });
  });
}

async function getPending() {
  return withStore('queue', 'readonly', store => {
    return new Promise(resolve => {
      const idx = store.index('synced');
      const req = idx.getAll(IDBKeyRange.only(0));
      req.onsuccess = () => resolve(req.result || []);
    });
  });
}

async function markSynced(local_id) {
  return withStore('queue', 'readwrite', store => {
    return new Promise(resolve => {
      const req = store.get(local_id);
      req.onsuccess = () => {
        const rec = req.result;
        if (rec) { rec.synced = 1; rec.synced_at = Date.now(); store.put(rec); }
        resolve();
      };
    });
  });
}

// ---- Sincronização ----
let syncing = false;
export async function sync() {
  if (syncing || !navigator.onLine) return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0, failed = 0;
  try {
    const pending = await getPending();
    for (const item of pending) {
      try {
        let resp;
        if (item.op === 'insert') {
          resp = await supabase.from(item.table).insert(item.payload);
        } else if (item.op === 'update') {
          resp = await supabase.from(item.table).update(item.payload.values).eq('id', item.payload.id);
        }
        if (resp && !resp.error) { await markSynced(item.local_id); sent++; }
        else { failed++; console.warn('sync fail', resp?.error); }
      } catch(e) { failed++; console.warn('sync err', e); }
    }
  } finally { syncing = false; }
  return { sent, failed };
}

// Auto-sync triggers
window.addEventListener('online', () => sync().then(r => {
  if (r.sent) window.dispatchEvent(new CustomEvent('sync-done', { detail: r }));
}));
setInterval(() => { if (navigator.onLine) sync(); }, 15000);

// ---- Cache (MP standard, produtos, etc) ----
export async function cachePut(key, value) {
  return withStore('cache', 'readwrite', store => store.put({ key, value, updated: Date.now() }));
}
export async function cacheGet(key) {
  return withStore('cache', 'readonly', store => new Promise(res => {
    const req = store.get(key);
    req.onsuccess = () => res(req.result?.value);
  }));
}

// ---- API pública para tabs ----
// Tenta online, se falhar enfileira. Sempre retorna {ok:true, offline:bool}.
export async function addMovimento(payload) {
  if (navigator.onLine) {
    const { error } = await supabase.from('movimentos').insert(payload);
    if (!error) return { ok: true, offline: false };
    console.warn('insert failed, queuing', error);
  }
  await enqueue('movimentos', 'insert', payload);
  return { ok: true, offline: true };
}
