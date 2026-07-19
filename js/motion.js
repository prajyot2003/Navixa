// Navixa — motion system: page transitions, ripples, pointer sheen, sliding nav indicator
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Wrap a synchronous DOM mutation in the View Transitions API when available.
let activeVT = null;
export function withTransition(mutate) {
  if (reduce() || !document.startViewTransition) { mutate(); return; }
  if (activeVT) { mutate(); return; } // never overlap transitions (avoids InvalidStateError)
  try {
    const vt = document.startViewTransition(() => mutate());
    activeVT = vt;
    const clear = () => { activeVT = null; };
    // Swallow every promise the API exposes — a skipped/aborted transition
    // rejects .ready (and sometimes .updateCallbackDone) with InvalidStateError.
    vt.finished.then(clear, clear);
    vt.ready?.catch(() => {});
    vt.updateCallbackDone?.catch(() => {});
  } catch { activeVT = null; mutate(); }
}

// Slide a single indicator element behind the active nav item.
export function moveNavIndicator(nav) {
  if (!nav) return;
  const ind = nav.querySelector('.nav-ind');
  const active = nav.querySelector('.nav-item.active');
  if (!ind) return;
  if (!active) { ind.style.opacity = '0'; return; }
  const top = active.offsetTop, h = active.offsetHeight;
  if (!h) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.transform = `translateY(${top}px)`;
  ind.style.height = `${h}px`;
}

// Material-style ripple on any .btn click.
function ripple(e) {
  const btn = e.target.closest('.btn');
  if (!btn || reduce()) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = `${size}px`;
  s.style.left = `${e.clientX - r.left - size / 2}px`;
  s.style.top = `${e.clientY - r.top - size / 2}px`;
  btn.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
}

// Pointer-follow sheen for elements that opt in via [data-sheen].
function sheen(e) {
  const t = e.target.closest?.('[data-sheen]');
  if (!t) return;
  const r = t.getBoundingClientRect();
  t.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  t.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}

export function initMotion() {
  document.addEventListener('pointerdown', ripple, { passive: true });
  document.addEventListener('pointermove', sheen, { passive: true });
}
