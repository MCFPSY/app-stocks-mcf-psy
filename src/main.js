import { supabase, getProfile } from './supabase.js';
import { renderLogin } from './ui/login.js';
import { renderApp } from './ui/app.js';
import './offline.js';
import './styles.css';
// PWA registration handled by vite-plugin-pwa (only in production build)

const root = document.getElementById('root');
let bootstrapping = false;

async function bootstrap() {
  if (bootstrapping) return;
  bootstrapping = true;
  try {
    let session = null;
    try {
      const result = await Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      session = result.data.session;
    } catch {
      localStorage.removeItem('stocks-mcf-psy-auth');
    }
    if (!session) {
      renderLogin(root, () => { bootstrapping = false; bootstrap(); });
      return;
    }
    const profile = await getProfile();
    if (!profile) {
      root.innerHTML = '<div style="padding:40px;text-align:center">Sem perfil associado. Contacta o admin.</div>';
      return;
    }
    renderApp(root, profile);
  } finally {
    bootstrapping = false;
  }
}

supabase.auth.onAuthStateChange((_evt, session) => {
  // Only re-bootstrap on sign-out (session becomes null)
  if (!session) bootstrap();
});
bootstrap();
