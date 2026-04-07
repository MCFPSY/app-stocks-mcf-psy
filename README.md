# App Stocks MCF + PSY

PWA para gestão, criação, alteração e transferências de stocks entre MCF e PSY.

## Stack
- **Frontend:** PWA vanilla JS (Vite) — pensado para tablets Zebra Android
- **Backend:** Supabase (Postgres + Auth + Realtime)
- **Deploy:** GitHub Pages / Vercel

## Estrutura
```
/              → raiz PWA (index.html, manifest, sw)
/src           → JS modular (auth, db, tabs, ui)
/supabase      → schema.sql + seeds + migrations
/scripts       → importação Excel → Supabase
```

## Tabs
1. Malotes Produção MCF
2. Transferências MCF → PSY
3. Inventário Permanente
4. Movimentos por dia
5. Pedidos de transferência
6. Dúvidas (validação admin)
7. Ajustes (admin)

## Desenvolvimento
```
npm install
npm run dev
```
