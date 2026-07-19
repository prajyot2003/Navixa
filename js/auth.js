// Navixa — auth: Supabase Google OAuth (cloud) / Google Identity Services (local) / demo accounts
import { globalSettings, saveGlobal, signIn, signOut as storeSignOut } from './store.js';
import { toast, uid, icon } from './utils.js';
import { cloudEnabled, signInWithGoogle, cloudSignOut } from './cloud.js';

let gisLoaded = false;

export function hasGoogle() { return !!globalSettings.googleClientId; }

export function loadGis() {
  return new Promise((resolve, reject) => {
    if (gisLoaded && window.google?.accounts?.id) return resolve();
    const existing = document.querySelector('script[data-gis]');
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true; s.dataset.gis = '1';
    s.onload = () => { gisLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Could not load Google Sign-In script'));
    document.head.appendChild(s);
  });
}

export async function renderGoogleButton(container, { onSignedIn } = {}) {
  // Cloud mode: Supabase handles Google OAuth (full redirect flow, real accounts + roles)
  if (cloudEnabled()) {
    container.innerHTML = `<button class="btn btn-ghost btn-block btn-lg" data-sb-google>${icon('google', 18)} Continue with Google</button>`;
    container.querySelector('[data-sb-google]').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await signInWithGoogle(); } // redirects away
      catch (err) { toast(`Google sign-in failed: ${err.message}`, 'warn'); e.currentTarget.disabled = false; }
    };
    return true;
  }
  const clientId = globalSettings.googleClientId;
  if (!clientId) return false;
  try {
    await loadGis();
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (resp) => {
        try {
          const p = decodeJwt(resp.credential);
          signIn({
            sub: `google-${p.sub}`, provider: 'google',
            name: p.name || p.email, email: p.email || '', picture: p.picture || '',
          });
          toast(`Welcome, ${p.given_name || p.name || 'there'}!`);
          onSignedIn?.();
        } catch (e) { console.error(e); toast('Google sign-in failed to parse', 'warn'); }
      },
      auto_select: false,
    });
    container.innerHTML = '';
    window.google.accounts.id.renderButton(container, {
      theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
      size: 'large', shape: 'pill', width: 320, text: 'continue_with', logo_alignment: 'left',
    });
    return true;
  } catch (e) {
    console.warn('GIS init failed', e);
    return false;
  }
}

export function decodeJwt(token) {
  const part = token.split('.')[1];
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  return JSON.parse(json);
}

export function demoSignIn(name) {
  const clean = String(name || '').trim() || 'Explorer';
  signIn({ sub: `demo-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uid().slice(0, 4)}`, provider: 'demo', name: clean, email: '', picture: '' });
  toast(`Welcome, ${clean}!`);
}

export function signOut() {
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch {}
  if (cloudEnabled()) cloudSignOut();
  storeSignOut();
}

export function saveClientId(id) {
  saveGlobal({ googleClientId: String(id || '').trim() });
}
