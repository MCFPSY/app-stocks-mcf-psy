import { supabase, getProfile } from './supabase.js';
import { renderLogin } from './ui/login.js';
import { renderApp } from './ui/app.js';
import './offline.js';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

const root = document.getElementById('root');

async function bootstrap() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    renderLogin(root, bootstrap);
    return;
  }
  const profile = await getProfile();
  if (!profile) {
    root.innerHTML = '<div style="padding:40px;text-align:center">Sem perfil associado. Contacta o admin.</div>';
    return;
  }
  renderApp(root, profile);
}

supabase.auth.onAuthStateChange((_evt, _session) => bootstrap());
bootstrap();
