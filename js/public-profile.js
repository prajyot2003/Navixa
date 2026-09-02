// Navixa — shareable public profile pages (/#/u/<slug>).
// Only the fields the user ticks are published, into a table separate from
// `profiles` so email/role/stats can never leak. See supabase-public-profiles.sql.
import { client, cloudEnabled, cloudSession } from './cloud.js';
import { getResume } from './resume.js';
import { getState } from './store.js';
import { $, $$, el, esc, icon, toast, modal, skeleton, safeUrl} from './utils.js';

export const slugify = (s) => String(s || '')
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40)
  .replace(/-+$/, '');

export const profileUrl = (slug) => `${location.origin}${location.pathname}#/u/${slug}`;

/** Build the publishable snapshot from the resume + profile, honouring the section toggles. */
export function buildSnapshot(opts = {}) {
  const r = getResume();
  const p = getState().profile || {};
  const inc = { summary: true, experience: true, projects: true, education: true, skills: true, certifications: true, contact: false, ...opts };
  const b = r.basics || {};
  return {
    name: b.name || p.name || '',
    headline: b.headline || p.targetRole || '',
    location: b.location || '',
    links: {
      linkedin: b.linkedin || '', github: b.github || '', website: b.website || '',
      ...(inc.contact ? { email: b.email || '', phone: b.phone || '' } : {}),
    },
    summary: inc.summary ? (r.summary || '') : '',
    experience: inc.experience ? (r.experience || []) : [],
    projects: inc.projects ? (r.projects || []) : [],
    education: inc.education ? (r.education || []) : [],
    skills: inc.skills ? (r.skills || []) : [],
    certifications: inc.certifications ? (r.certifications || []) : [],
    accent: r.accent || '',
    updatedAt: Date.now(),
  };
}

/* ---------- data access ---------- */

export async function myPublicProfile() {
  const c = client(); const sess = cloudSession();
  if (!c || !sess) return null;
  const { data, error } = await c.from('public_profiles').select('*').eq('user_id', sess.user.id).maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new Error('SETUP');
    throw error;
  }
  return data;
}

export async function publish({ slug, data, published = true }) {
  const c = client(); const sess = cloudSession();
  if (!c || !sess) throw new Error('Sign in with Google first.');
  const clean = slugify(slug);
  if (clean.length < 3) throw new Error('Pick a longer link name (at least 3 characters).');

  const existing = await myPublicProfile();
  // Changing slug means replacing the row, since slug is the primary key.
  if (existing && existing.slug !== clean) {
    await c.from('public_profiles').delete().eq('user_id', sess.user.id);
  }
  const { error } = await c.from('public_profiles')
    .upsert({ slug: clean, user_id: sess.user.id, data, published }, { onConflict: 'slug' });
  if (error) {
    if (isMissingTable(error)) throw new Error('SETUP');
    if (String(error.code) === '23505' || /duplicate|unique/i.test(error.message || '')) {
      throw new Error(`“${clean}” is already taken — try another.`);
    }
    throw error;
  }
  return clean;
}

export async function unpublish() {
  const c = client(); const sess = cloudSession();
  if (!c || !sess) return;
  await c.from('public_profiles').update({ published: false }).eq('user_id', sess.user.id);
}

export async function fetchBySlug(slug) {
  const c = client();
  if (!c) throw new Error('SETUP');
  const { data, error } = await c.from('public_profiles').select('slug, data, published').eq('slug', slug).maybeSingle();
  if (error) { if (isMissingTable(error)) throw new Error('SETUP'); throw error; }
  if (!data || !data.published) return null;
  try { await c.rpc('bump_profile_views', { p_slug: slug }); } catch { /* view counting is best-effort */ }
  return data.data;
}

const isMissingTable = (e) =>
  String(e?.code) === '42P01' || /public_profiles/i.test(e?.message || '') && /does not exist|schema cache/i.test(e?.message || '');

/* ---------- public view (works logged-out) ---------- */

export function publicProfileView(slug) {
  const root = el('<div class="pub-wrap"></div>');
  root.innerHTML = skeleton(3);

  // Declared with `function` so it is hoisted above the async IIFE below.
  function notFound(msg) {
    return `<article class="pub-card pub-empty">
      ${icon('user', 40)}
      <h1>Profile not found</h1>
      <p>${esc(msg)}</p>
      <a class="btn btn-primary" href="${esc(location.pathname)}#/dashboard">Go to Navixa</a>
    </article>`;
  }

  (async () => {
    if (!cloudEnabled()) { root.innerHTML = notFound('Public profiles need the cloud backend.'); return; }
    let d;
    try { d = await fetchBySlug(slug); }
    catch (e) {
      root.innerHTML = e.message === 'SETUP'
        ? notFound('Public profiles aren’t set up on this deployment yet.')
        : notFound('Could not load this profile.');
      return;
    }
    if (!d) { root.innerHTML = notFound('No published profile at this link.'); return; }
    render(d);
  })();

  function render(d) {
    const links = Object.entries(d.links || {}).filter(([, v]) => v);
    const sec = (title, inner) => (inner ? `<section class="pub-sec"><h2>${esc(title)}</h2>${inner}</section>` : '');
    const bullets = (arr) => ((arr || []).filter(Boolean).length
      ? `<ul>${arr.filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '');

    root.innerHTML = `
      <article class="pub-card">
        <header class="pub-head">
          <h1>${esc(d.name || 'Navixa profile')}</h1>
          ${d.headline ? `<p class="pub-role">${esc(d.headline)}</p>` : ''}
          <p class="pub-meta">
            ${d.location ? `<span>${icon('pin', 13)} ${esc(d.location)}</span>` : ''}
            ${links.map(([k, v]) => {
              const raw = k === 'email' ? `mailto:${v}` : k === 'phone' ? `tel:${v}` : (/^https?:/i.test(v) ? v : `https://${v}`);
              const href = safeUrl(raw);
              return `<a href="${esc(href)}" target="_blank" rel="noopener nofollow">${esc(v.replace(/^https?:\/\//, ''))}</a>`;
            }).join('')}
          </p>
        </header>

        ${sec('About', d.summary ? `<p>${esc(d.summary)}</p>` : '')}

        ${sec('Experience', (d.experience || []).map((e) => `
          <div class="pub-item">
            <b>${esc(e.role || '')}</b>${e.company ? ` · ${esc(e.company)}` : ''}
            <span class="pub-when">${esc([e.start, e.end].filter(Boolean).join(' – '))}</span>
            ${bullets(e.bullets)}
          </div>`).join(''))}

        ${sec('Projects', (d.projects || []).map((p) => `
          <div class="pub-item">
            <b>${p.link ? `<a href="${esc(safeUrl(/^https?:/i.test(p.link) ? p.link : `https://${p.link}`))}" target="_blank" rel="noopener nofollow">${esc(p.name || '')}</a>` : esc(p.name || '')}</b>
            ${p.desc ? ` — ${esc(p.desc)}` : ''}
            ${bullets(p.bullets)}
          </div>`).join(''))}

        ${sec('Education', (d.education || []).map((e) => `
          <div class="pub-item">
            <b>${esc(e.degree || '')}</b>${e.school ? ` · ${esc(e.school)}` : ''}
            <span class="pub-when">${esc(e.year || '')}</span>
            ${e.score ? `<div class="muted">${esc(e.score)}</div>` : ''}
          </div>`).join(''))}

        ${sec('Skills', (d.skills || []).length ? `<div class="pub-chips">${d.skills.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : '')}

        ${sec('Certifications', (d.certifications || []).map((c) => `
          <div class="pub-item"><b>${esc(c.name || '')}</b>${c.by ? ` · ${esc(c.by)}` : ''}<span class="pub-when">${esc(c.year || '')}</span></div>`).join(''))}

        <footer class="pub-foot">
          <a href="${esc(location.pathname)}#/dashboard">Built with Navixa</a>
        </footer>
      </article>`;
    document.title = `${d.name || 'Profile'} · Navixa`;
  }

  return root;
}

/* ---------- owner controls (rendered on the Profile page) ---------- */

export function publicProfileCard() {
  const wrap = el(`<div class="card mt-2">
    <div class="card-title">${icon('link')} Public profile <span class="more muted">share a read-only page</span></div>
    <div data-out>${skeleton(1)}</div>
  </div>`);
  const out = $('[data-out]', wrap);

  const setupHelp = () => {
    out.innerHTML = `<p class="sub">One-time setup needed: run <code>supabase-public-profiles.sql</code> in your Supabase SQL editor, then reload.</p>`;
  };

  (async () => {
    if (!cloudEnabled() || !cloudSession()) {
      out.innerHTML = '<p class="sub">Sign in with Google to publish a shareable profile.</p>';
      return;
    }
    let mine = null;
    try { mine = await myPublicProfile(); }
    catch (e) { if (e.message === 'SETUP') return setupHelp(); out.innerHTML = `<p class="sub">${esc(e.message)}</p>`; return; }
    renderForm(mine);
  })();

  function renderForm(mine) {
    const r = getResume();
    const suggested = mine?.slug || slugify(r.basics?.name || getState().profile?.name || 'me');
    const live = !!mine?.published;
    out.innerHTML = `
      <div class="field"><label>Your link</label>
        <div class="row" style="gap:6px;align-items:center;flex-wrap:nowrap">
          <span class="muted" style="white-space:nowrap">…/#/u/</span>
          <input class="input" data-slug value="${esc(suggested)}" placeholder="your-name" style="min-width:0">
        </div>
      </div>
      <div class="field"><label>Include</label>
        <div class="row wrap" style="gap:12px">
          ${[['summary', 'About'], ['experience', 'Experience'], ['projects', 'Projects'], ['education', 'Education'], ['skills', 'Skills'], ['certifications', 'Certifications'], ['contact', 'Email &amp; phone']]
            .map(([k, label]) => `<label class="switch"><input type="checkbox" data-inc="${k}" ${k === 'contact' ? '' : 'checked'}><span class="track"></span>${label}</label>`).join('')}
        </div>
        <p class="muted" style="margin-top:6px">${icon('info', 12)} Anything unticked is never uploaded. Email and phone are off by default.</p>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-pub>${icon('check', 15)} ${live ? 'Update' : 'Publish'}</button>
        ${live ? `<a class="btn btn-ghost btn-sm" href="#/u/${esc(mine.slug)}" target="_blank">${icon('external', 15)} View</a>
          <button class="btn btn-ghost btn-sm" data-copy>${icon('copy', 15)} Copy link</button>
          <button class="btn btn-ghost btn-sm" data-unpub>${icon('x', 15)} Unpublish</button>` : ''}
      </div>
      ${live ? `<p class="muted" style="margin-top:8px">${icon('eye', 12)} Live at <code>${esc(profileUrl(mine.slug))}</code>${mine.views ? ` · ${mine.views} view${mine.views === 1 ? '' : 's'}` : ''}</p>` : ''}`;

    $('[data-pub]', out).onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      const opts = {};
      $$('[data-inc]', out).forEach((c) => { opts[c.dataset.inc] = c.checked; });
      try {
        const slug = await publish({ slug: $('[data-slug]', out).value, data: buildSnapshot(opts), published: true });
        toast('Profile published');
        renderForm({ slug, published: true, views: mine?.views || 0 });
      } catch (err) {
        toast(err.message === 'SETUP' ? 'Run the setup SQL first' : err.message, 'warn');
        btn.disabled = false;
      }
    };
    $('[data-copy]', out)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(profileUrl(mine.slug)); toast('Link copied'); }
      catch { toast('Copy failed — select the link manually', 'warn'); }
    });
    $('[data-unpub]', out)?.addEventListener('click', async () => {
      await unpublish(); toast('Profile is now private'); renderForm({ ...mine, published: false });
    });
  }

  return wrap;
}
