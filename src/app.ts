/**
 * App boot. P1: minimal shell proving the toolchain + extracted design tokens.
 * P2 replaces this with the real screens as modules are migrated.
 */
export function boot(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app root missing');

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--s-4);background:var(--bg);height:100dvh';

  const logo = document.createElement('div');
  logo.style.cssText =
    'width:72px;height:72px;border-radius:var(--r-lg);background:var(--accent-grad);box-shadow:var(--shadow-lg)';

  const title = document.createElement('h1');
  title.textContent = 'Seseri 2.0';
  title.style.cssText =
    'font-family:var(--font-display);font-size:var(--fs-2xl);color:var(--text);letter-spacing:-0.02em';

  const sub = document.createElement('p');
  sub.textContent = 'Vite + TypeScript iskelesi çalışıyor — migrasyon P2 ile başlıyor.';
  sub.style.cssText = 'font-family:var(--font-mono);font-size:var(--fs-sm);color:var(--text2)';

  wrap.append(logo, title, sub);
  app.replaceChildren(wrap);
}
