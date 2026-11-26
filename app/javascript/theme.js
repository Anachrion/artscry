// Theme switcher: Auto (follows the OS) → Light → Dark.
// The choice is stored in localStorage and applied as <html data-theme="…">.
// An inline script in the layout applies it before first paint to avoid a flash.
const KEY = 'theme';
const ORDER = ['auto', 'light', 'dark'];
const LABELS = { auto: ['◐', 'Auto'], light: ['☀', 'Light'], dark: ['☾', 'Dark'] };

const current = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } };

function apply(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = mode;
  try { mode === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ }
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    const [icon, label] = LABELS[mode];
    b.innerHTML = `<span class="ic" aria-hidden="true">${icon}</span> ${label}`;
    b.title = `Theme: ${label} (click to change)`;
  });
}

function boot() {
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    b.addEventListener('click', () => apply(ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length]));
  });
  apply(current());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
