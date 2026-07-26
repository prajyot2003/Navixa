// Navixa — DOM + misc utilities
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function timeAgo(dateish) {
  const d = new Date(dateish); if (isNaN(d)) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24); if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7); if (w < 5) return `${w}w ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

export function stripHtml(html, max = 0) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  let text = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
  if (max && text.length > max) text = text.slice(0, max).replace(/\s\S*$/, '') + '…';
  return text;
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

let toastWrap;
export function toast(msg, type = 'ok', ms = 3200) {
  if (!toastWrap) { toastWrap = el('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(toastWrap); }
  const t = el(`<div class="toast toast-${type}">${icon(type === 'ok' ? 'check' : type === 'warn' ? 'alert' : type === 'xp' ? 'zap' : 'info')}<span>${esc(msg)}</span></div>`);
  toastWrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, ms);
}

export function confetti(x = 0.5, y = 0.35) {
  const colors = ['#6d5dfc', '#22d3ee', '#f59e0b', '#34d399', '#f472b6'];
  for (let i = 0; i < 26; i++) {
    const p = el(`<i class="confetti" style="left:${x * 100}%;top:${y * 100}%;background:${colors[i % colors.length]}"></i>`);
    document.body.appendChild(p);
    const ang = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
    p.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${Math.cos(ang) * v}px, ${Math.sin(ang) * v + 140}px) rotate(${Math.random() * 540 - 270}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
  }
}

export function modal({ title, body, actions = [], wide = false, onClose } = {}) {
  const wrap = el(`<div class="modal-backdrop"><div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div>
  </div></div>`);
  const bodyEl = $('.modal-body', wrap);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const foot = $('.modal-foot', wrap);
  if (!actions.length) foot.remove();
  actions.forEach(({ label, primary, danger, onClick }) => {
    const b = el(`<button class="btn ${primary ? 'btn-primary' : danger ? 'btn-danger' : 'btn-ghost'}">${esc(label)}</button>`);
    b.addEventListener('click', () => { const r = onClick?.(wrap); if (r !== false) close(); });
    foot.appendChild(b);
  });
  function close() { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); onClose?.(); }
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  const escH = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); } };
  document.addEventListener('keydown', escH);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  return { close, el: wrap };
}

// --- Icon set (inline SVG, stroke style) ---
const P = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  briefcase: 'M4 7h16v13H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16',
  sparkles: 'M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8zM19 15l.9 2.3L22 18l-2.1.8L19 21l-.9-2.2L16 18l2.1-.7zM5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8L2.5 17.5l1.8-.7z',
  file: 'M6 2h8l4 4v16H6zM14 2v4h4M9 12h6M9 16h6M9 8h2',
  message: 'M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12zM8 10h8M8 13.5h5',
  play: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM10 9l5 3-5 3z',
  flame: 'M12 3s5.5 4.2 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 9.8 8.5 8 9.5 6c.8 1.2 1.3 2 1.2 3.5C12.5 8 12 5 12 3zM12 21a3 3 0 0 0 3-3c0-2-1.5-2.6-3-4.5-1.5 1.9-3 2.5-3 4.5a3 3 0 0 0 3 3z',
  kanban: 'M4 4h4.5v16H4zM9.75 4h4.5v10h-4.5zM15.5 4H20v13h-4.5z',
  user: 'M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19 12c0-.6.5-1.2 1.1-1.7l-1-2.6c-.8.1-1.6 0-2-.5-.5-.4-.6-1.2-.5-2l-2.6-1c-.5.6-1.1 1.1-1.7 1.1h-.6C11 5.3 10.4 4.8 10 4.2l-2.6 1c.1.8 0 1.6-.5 2-.4.5-1.2.6-2 .5l-1 2.6c.6.5 1.1 1.1 1.1 1.7v.6c0 .6-.5 1.2-1.1 1.7l1 2.6c.8-.1 1.6 0 2 .5.5.4.6 1.2.5 2l2.6 1c.4-.6 1-1.1 1.6-1.1h.7c.6 0 1.2.5 1.6 1.1l2.6-1c-.1-.8 0-1.6.5-2 .4-.5 1.2-.6 2-.5l1-2.6c-.6-.5-1.1-1.1-1.1-1.7z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.8-2.6 2.3-2.6 3.8M12 17.2v.1',
  search: 'M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4zM16 16l5 5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M4.5 12.5l5 5L19.5 7',
  external: 'M14 4h6v6M20 4l-9 9M11 5H5v14h14v-6',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z',
  chevD: 'M6 9.5l6 6 6-6',
  chevR: 'M9.5 6l6 6-6 6',
  chevL: 'M14.5 6l-6 6 6 6',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  upload: 'M12 15V3M7 8l5-5 5 5M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6',
  edit: 'M4 20l4.5-.9L20 7.6 16.4 4 4.9 15.5zM13.5 6.9l3.6 3.6',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z',
  pin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5.2l3.4 2',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M20 21V11a2 2 0 0 0-2-2h-2M8 7h2M8 11h2M8 15h2M2.5 21h19',
  zap: 'M13 2L4.5 13.5H11L10 22l8.5-11.5H13z',
  trophy: 'M8 4h8v3a4 4 0 0 1-8 0zM8 5H4.5a3.5 3.5 0 0 0 3.6 3.5M16 5h3.5a3.5 3.5 0 0 1-3.6 3.5M12 11v4M8.5 21h7M12 15c-1 0-2 .8-2.3 2l-.4 1.7c-.1.7-.1 1.3-.1 1.3h5.6s0-.6-.1-1.3l-.4-1.7c-.3-1.2-1.3-2-2.3-2z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12h.01',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1zM8 3v4M16 3v4M4 10h16',
  send: 'M21 3L10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z',
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 3v4h-4',
  link: 'M9.5 14.5l5-5M8 11l-2.4 2.4a3.8 3.8 0 0 0 5.4 5.4L13.5 16M16 13l2.4-2.4a3.8 3.8 0 0 0-5.4-5.4L10.5 8',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  shield: 'M12 3l7.5 3v5.5c0 4.7-3.2 8-7.5 9.5-4.3-1.5-7.5-4.8-7.5-9.5V6z',
  award: 'M12 14.5a5.2 5.2 0 1 0 0-10.5 5.2 5.2 0 0 0 0 10.5zM8.8 13.4L7.5 21l4.5-2.5L16.5 21l-1.3-7.6',
  book: 'M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5zM19 4h-6a0 0 0 0 0 0 0v16a0 0 0 0 1 0 0h6z M13 6a2 2 0 0 1 2-2M13 20a2 2 0 0 1 2-2h4',
  layers: 'M12 3l9 5-9 5-9-5zM4.5 12.5L12 16.7l7.5-4.2M4.5 16.5L12 20.7l7.5-4.2',
  filter: 'M4 5h16l-6.2 7.2V19l-3.6 2v-8.8z',
  logout: 'M14 4h-8a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8M10 12h11M18 8.5L21.5 12 18 15.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  mic: 'M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15zM6 11.5a6 6 0 0 0 12 0M12 17.5V21M9 21h6',
  paperclip: 'M20 11.3l-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9',
  alert: 'M12 3l10 17.5H2zM12 10v5M12 18.2v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 10.5V17M12 7v.1',
  flag: 'M5 21V4M5 5c4-2.5 7 1.5 11 0l2-.8V13c-4 2.5-7-1.5-11 0l-2 .8',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  google: '',
  menu: 'M4 6.5h16M4 12h16M4 17.5h16',
  dots: 'M12 6.2v.1M12 12v.1M12 17.8v.1',
  arrowR: 'M4 12h16M14 6l6 6-6 6',
};
export function icon(name, size = 20) {
  if (name === 'google') return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.8 18.8 23 15.9 23 12.3z"/><path fill="#34A853" d="M12 23c3 0 5.6-1 7.4-2.7l-3.7-2.9c-1 .7-2.3 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.6H2v3A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 13.9a6.6 6.6 0 0 1 0-4.2v-3H2a11 11 0 0 0 0 10.1z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2 6.8l3.8 3A6.6 6.6 0 0 1 12 5.4z"/></svg>`;
  const d = P[name] || P.info;
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

export function avatarHtml(user, size = 36) {
  if (user?.picture) return `<img class="avatar" width="${size}" height="${size}" src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer">`;
  return `<span class="avatar avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${esc(initials(user?.name))}</span>`;
}

// Animate a number counting up inside an element (keeps optional suffix)
export function countUp(elm, target, { duration = 900, suffix = '' } = {}) {
  target = Number(target) || 0;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    elm.textContent = Math.round(target * eased) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function skeleton(n = 3, cls = 'card') {
  return Array.from({ length: n }, () => `<div class="${cls} skeleton"><div class="sk-line w60"></div><div class="sk-line w90"></div><div class="sk-line w40"></div></div>`).join('');
}

export function emptyState(iconName, title, sub, action = '') {
  return `<div class="empty">${icon(iconName, 40)}<h3>${esc(title)}</h3><p>${esc(sub)}</p>${action}</div>`;
}
