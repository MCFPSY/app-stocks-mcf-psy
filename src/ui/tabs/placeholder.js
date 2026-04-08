export function renderPlaceholder(el, title, msg) {
  el.innerHTML = `
    <div class="card">
      <h2>${title}</h2>
      <p class="sub">${msg}</p>
    </div>
  `;
}
