import { supabase } from '../supabase.js';

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login-box" id="loginForm">
        <h1>📦 Stocks MCF + PSY</h1>
        <p class="sub">Inicia sessão para continuar</p>
        <div id="err"></div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="email" required value="goncalo@mcfpsy.local">
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" id="pwd" required>
        </div>
        <button class="btn btn-primary btn-big" id="btn">Entrar</button>
      </form>
    </div>
  `;
  const form = root.querySelector('#loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = root.querySelector('#email').value.trim();
    const pwd = root.querySelector('#pwd').value;
    const btn = root.querySelector('#btn');
    const err = root.querySelector('#err');
    btn.disabled = true; btn.textContent = 'A entrar...';
    err.innerHTML = '';
    const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
    if (error) {
      err.innerHTML = `<div class="login-err">${error.message}</div>`;
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }
    onSuccess && onSuccess();
  });
}
