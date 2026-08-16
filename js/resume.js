// Navixa — resume builder: data, form, live preview, templates, ATS score, print/PDF
import { getState, update, currentUser } from './store.js';
import { $, $$, el, esc, icon, uid, debounce, toast } from './utils.js';
import { logActivity, recordAts } from './gamify.js';

export function defaultResume(user, profile) {
  return {
    template: 'modern', accent: '#6d5dfc',
    basics: {
      name: user?.name || '', email: user?.email || '', phone: '',
      location: profile?.location || '', headline: profile?.targetRole || profile?.headline || '',
      website: '', linkedin: '', github: '',
    },
    summary: '',
    experience: [], education: [], projects: [],
    skills: profile?.skills?.slice(0, 12) || [],
    certifications: [],
  };
}

export function getResume() {
  const s = getState();
  if (!s.resume) {
    update((st) => { st.resume = defaultResume(currentUser(), st.profile); }, { type: 'resume' });
  }
  return getState().resume;
}

const saveEdit = debounce(() => logActivity('resume_edit'), 15000);

export function patchResume(mut) {
  update((st) => { mut(st.resume); }, { type: 'resume' });
  saveEdit();
}

// Merge a parsed/imported resume into the current one — only overwrite fields
// that actually carry content, so a partial parse never wipes existing data.
export function mergeResume(rr, p) {
  if (p.basics) for (const [k, v] of Object.entries(p.basics)) { if (v) rr.basics[k] = v; }
  if (p.summary) rr.summary = p.summary;
  if (p.experience && p.experience.length) rr.experience = p.experience;
  if (p.projects && p.projects.length) rr.projects = p.projects;
  if (p.education && p.education.length) rr.education = p.education;
  if (p.certifications && p.certifications.length) rr.certifications = p.certifications;
  if (p.skills && p.skills.length) {
    rr.skills = Array.from(new Set([...(rr.skills || []), ...p.skills])).slice(0, 20);
  }
}

/* ================= ATS score ================= */
const ACTION_VERBS = ['led','built','created','designed','developed','launched','improved','increased','reduced','delivered','managed','shipped','automated','implemented','optimized','drove','grew','saved','achieved','won','founded','initiated','streamlined','negotiated','mentored','analyzed','researched','architected','migrated','scaled','owned','spearheaded','authored','presented','taught','coordinated','directed','established'];
const CLICHES = ['team player','hard working','hardworking','go-getter','think outside the box','synergy','results-driven','detail-oriented','self-starter','dynamic individual','works well under pressure'];

export function atsScore(r, profile = {}) {
  const checks = [];
  const add = (pass, pts, label, tip) => { checks.push({ pass, pts: pass ? pts : 0, max: pts, label, tip }); };
  const b = r.basics || {};
  const allBullets = [...(r.experience || []), ...(r.projects || [])].flatMap((e) => e.bullets || []);
  const fullText = [b.name, b.headline, r.summary, ...(r.skills || []), ...allBullets,
    ...(r.experience || []).map((e) => `${e.role} ${e.company}`),
    ...(r.education || []).map((e) => `${e.degree} ${e.school}`)].join(' ').toLowerCase();
  const words = fullText.split(/\s+/).filter(Boolean).length;

  add(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || ''), 10, 'Email address', 'Add a professional email address.');
  add(!!(b.phone || '').trim(), 5, 'Phone number', 'Add a phone number recruiters can reach you on.');
  add(!!(b.location || '').trim(), 4, 'Location', 'Add your city/country — many ATS filters use it.');
  add(!!(b.linkedin || b.website || b.github || '').trim(), 5, 'Portfolio / LinkedIn link', 'Add a LinkedIn, GitHub or portfolio URL.');
  add(!!(b.headline || '').trim(), 5, 'Professional headline', 'Add a headline matching your target role.');
  const sumLen = (r.summary || '').trim().length;
  add(sumLen >= 80 && sumLen <= 600, 8, 'Focused summary (80–600 chars)', 'Write a 2–3 sentence summary tailored to the role.');
  add((r.experience || []).length > 0 || (r.projects || []).length > 0, 10, 'Experience or projects listed', 'Add at least one experience entry or project.');
  const verbStarts = allBullets.filter((bl) => ACTION_VERBS.some((v) => bl.trim().toLowerCase().startsWith(v)));
  add(allBullets.length > 0 && verbStarts.length / Math.max(1, allBullets.length) >= 0.5, 10, 'Bullets start with action verbs', 'Start bullets with verbs like “Built”, “Led”, “Improved”.');
  const quantified = allBullets.filter((bl) => /\d|%|\$|€|£/.test(bl));
  add(allBullets.length > 0 && quantified.length / Math.max(1, allBullets.length) >= 0.3, 10, 'Quantified impact (numbers, %)', 'Add numbers: “cut load time 40%”, “served 2k users”.');
  add((r.education || []).length > 0, 6, 'Education section', 'Add your education (degree, school, year).');
  add((r.skills || []).length >= 5, 8, 'At least 5 skills', 'List 5–12 concrete skills (tools, languages, methods).');
  add(words >= 200 && words <= 1000, 8, 'Good length (200–1000 words)', words < 200 ? 'Too short — add detail to your bullets.' : 'Trim to the most relevant content.');
  const target = (profile.targetRole || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const kwHit = target.length ? target.filter((w) => fullText.includes(w)).length / target.length : 0;
  add(!target.length || kwHit >= 0.5, 6, 'Matches your target role keywords', `Weave “${profile.targetRole || 'your target role'}” keywords into headline/summary.`);
  const cliches = CLICHES.filter((c) => fullText.includes(c));
  add(cliches.length === 0, 5, 'No clichés', cliches.length ? `Remove: ${cliches.slice(0, 3).join(', ')}` : '');

  const max = checks.reduce((a, c) => a + c.max, 0);
  const got = checks.reduce((a, c) => a + c.pts, 0);
  return { score: Math.round((got / max) * 100), checks };
}

/* ================= Preview rendering ================= */
export function renderResumeHtml(r) {
  const b = r.basics || {};
  const contact = [b.email, b.phone, b.location, b.website, b.linkedin, b.github].filter(Boolean);
  const sec = (title, inner) => inner ? `<div class="rp-sec"><h4>${esc(title)}</h4>${inner}</div>` : '';
  const items = (arr, map) => (arr || []).length ? arr.map(map).join('') : '';
  const bullets = (bl) => (bl || []).filter(Boolean).length ? `<ul>${bl.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

  const exp = items(r.experience, (e) => `<div class="rp-item">
      <div class="rp-item-head"><span>${esc(e.role || 'Role')}</span><span>${esc(e.start || '')}${e.start || e.end ? ' – ' : ''}${esc(e.end || 'Present')}</span></div>
      <div class="rp-item-sub"><span>${esc(e.company || '')}</span><span>${esc(e.location || '')}</span></div>
      ${bullets(e.bullets)}</div>`);
  const edu = items(r.education, (e) => `<div class="rp-item">
      <div class="rp-item-head"><span>${esc(e.degree || 'Degree')}</span><span>${esc(e.year || '')}</span></div>
      <div class="rp-item-sub"><span>${esc(e.school || '')}</span><span>${esc(e.score || '')}</span></div></div>`);
  const proj = items(r.projects, (p) => `<div class="rp-item">
      <div class="rp-item-head"><span>${esc(p.name || 'Project')}</span><span>${esc(p.link || '')}</span></div>
      ${p.desc ? `<div class="rp-item-sub"><span>${esc(p.desc)}</span></div>` : ''}
      ${bullets(p.bullets)}</div>`);
  const certs = items(r.certifications, (c) => `<div class="rp-item"><div class="rp-item-head"><span>${esc(c.name || '')}</span><span>${esc(c.year || '')}</span></div><div class="rp-item-sub"><span>${esc(c.by || '')}</span></div></div>`);
  const skills = (r.skills || []).length ? `<div class="rp-skills">${r.skills.map((s) => `<span class="rp-skill">${esc(s)}</span>`).join('')}</div>` : '';

  return `<div class="rp-head">
      <div class="rp-name">${esc(b.name || 'Your Name')}</div>
      ${b.headline ? `<div class="rp-head-sub">${esc(b.headline)}</div>` : ''}
      <div class="rp-contact">${contact.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
    </div>
    ${sec('Summary', r.summary ? `<div>${esc(r.summary)}</div>` : '')}
    ${sec('Experience', exp)}
    ${sec('Projects', proj)}
    ${sec('Education', edu)}
    ${sec('Skills', skills)}
    ${sec('Certifications', certs)}`;
}

export function printResume() {
  const r = getResume();
  let mount = $('#print-mount');
  if (!mount) { mount = el('<div id="print-mount"></div>'); document.body.appendChild(mount); }
  mount.innerHTML = `<div class="resume-paper tpl-${esc(r.template)}" style="--rp-accent:${esc(r.accent)}">${renderResumeHtml(r)}</div>`;
  document.body.classList.add('printing-resume');
  const done = () => { document.body.classList.remove('printing-resume'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}

/* ================= View ================= */
export function resumeView() {
  const root = el('<div></div>');
  const r = getResume();

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Resume builder</h2><p class="lede">Fill in the form — the preview updates live. Export as PDF when it shines.</p></div>
      <div class="row">
        <button class="btn btn-ghost" data-act="tailor" title="Compare your resume with a job posting">${icon('target', 17)} Tailor to job</button>
        <button class="btn btn-ghost" data-act="letter" title="Generate a cover letter for a job">${icon('edit', 17)} Cover letter</button>
        <button class="btn btn-ghost" data-act="import" title="Import from PDF, Word (.docx) or Navixa JSON">${icon('upload', 17)} Import</button>
        <button class="btn btn-ghost" data-act="export">${icon('download', 17)} JSON</button>
        <button class="btn btn-primary" data-act="print">${icon('file', 17)} Download PDF</button>
      </div>
    </div>
    <div class="resume-layout">
      <div class="resume-form"></div>
      <div class="resume-preview-wrap">
        <div class="card" style="padding:16px" id="ats-card"></div>
        <div class="resume-toolbar mt-2">
          <span class="muted">Template</span>
          <div class="tabs" id="tpl-tabs">
            ${['modern', 'classic', 'compact'].map((t) => `<button class="tab ${r.template === t ? 'active' : ''}" data-tpl="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
          </div>
          <input type="color" id="rp-accent" value="${esc(r.accent)}" title="Accent color" style="width:34px;height:34px;border:1px solid var(--border);border-radius:9px;background:var(--surface);padding:2px;cursor:pointer">
        </div>
        <div class="resume-paper tpl-${esc(r.template)}" id="resume-paper" style="--rp-accent:${esc(r.accent)}"></div>
      </div>
    </div>`;

  const form = $('.resume-form', root);
  const paper = $('#resume-paper', root);

  const refreshPreview = () => {
    const rr = getResume();
    paper.className = `resume-paper tpl-${rr.template}`;
    paper.style.setProperty('--rp-accent', rr.accent);
    paper.innerHTML = renderResumeHtml(rr);
    renderAts();
  };

  function renderAts() {
    const rr = getResume();
    const s = getState();
    const { score, checks } = atsScore(rr, s.profile);
    const fails = checks.filter((c) => !c.pass).slice(0, 4);
    $('#ats-card', root).innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div class="card-title" style="margin:0">${icon('target')} ATS readiness</div>
        <b style="font-family:var(--font-display);font-size:22px">${score}<span class="muted" style="font-size:13px">/100</span></b>
      </div>
      <div class="ats-meter mt-1"><i style="width:${score}%"></i></div>
      <div class="ats-list">
        ${fails.map((c) => `<div class="ats-row fail">${icon('alert', 15)}<span><b>${esc(c.label)}.</b> ${esc(c.tip)}</span></div>`).join('') || `<div class="ats-row pass">${icon('check', 15)}<span>Excellent — all core checks pass. Tailor keywords per application.</span></div>`}
      </div>
      <button class="btn btn-soft btn-sm mt-2" data-act="ats-detail">${icon('eye', 15)} Full report</button>`;
    $('[data-act="ats-detail"]', root).onclick = () => {
      logActivity('ats_run');
      recordAts(score);
      import('./utils.js').then(({ modal }) => modal({
        title: `ATS report — ${score}/100`,
        body: `<div class="ats-list">${checks.map((c) => `<div class="ats-row ${c.pass ? 'pass' : 'fail'}">${icon(c.pass ? 'check' : 'alert', 15)}<span><b>${esc(c.label)}</b> (${c.pts}/${c.max})${!c.pass && c.tip ? ` — ${esc(c.tip)}` : ''}</span></div>`).join('')}</div>
          <p class="muted mt-2">Heuristic score based on common ATS parsing and recruiter best practices. Ask the AI chat for a deep review of the content itself.</p>`,
        actions: [{ label: 'Close', primary: true }],
      }));
    };
  }

  /* ---- form builders ---- */
  const F = (label, val, key, { type = 'text', ph = '', area = false } = {}) => `
    <div class="field"><label>${esc(label)}</label>
    ${area ? `<textarea class="input" data-k="${key}" placeholder="${esc(ph)}">${esc(val || '')}</textarea>`
      : `<input class="input" type="${type}" data-k="${key}" value="${esc(val || '')}" placeholder="${esc(ph)}">`}</div>`;

  function section(iconName, title, bodyHtml, open = false) {
    return `<details class="card rsec" ${open ? 'open' : ''}><summary>${icon(iconName)} ${esc(title)} <span class="chev">${icon('chevD', 16)}</span></summary><div class="rsec-body">${bodyHtml}</div></details>`;
  }

  function listEditor(kind, defs, itemLabel) {
    const rr = getResume();
    const arr = rr[kind] || [];
    return `
      <div data-list="${kind}">
        ${arr.map((item, i) => `<div class="ritem" data-i="${i}">
          <div class="row"><b style="font-size:13px">${esc(itemLabel)} ${i + 1}</b>
            <button class="icon-btn plain" data-del="${kind}:${i}" title="Remove">${icon('trash', 16)}</button></div>
          ${defs.map((d) => d.bullets
            ? `<div class="field"><label>Bullet points <span class="hint">(one per line)</span></label><textarea class="input" data-lk="${kind}:${i}:bullets" placeholder="Led X to achieve Y measured by Z…">${esc((item.bullets || []).join('\n'))}</textarea></div>`
            : F(d.label, item[d.key], '', { ph: d.ph || '' }).replace('data-k=""', `data-lk="${kind}:${i}:${d.key}"`)
          ).join('')}
        </div>`).join('')}
        <button class="btn btn-soft btn-sm" data-add="${kind}">${icon('plus', 15)} Add ${esc(itemLabel.toLowerCase())}</button>
      </div>`;
  }

  function renderForm() {
    const rr = getResume();
    form.innerHTML = [
      section('user', 'Basics', `
        ${F('Full name', rr.basics.name, 'basics.name', { ph: 'Ada Lovelace' })}
        <div class="grid grid-2">${F('Email', rr.basics.email, 'basics.email', { ph: 'you@email.com' })}${F('Phone', rr.basics.phone, 'basics.phone', { ph: '+91 …' })}</div>
        <div class="grid grid-2">${F('Location', rr.basics.location, 'basics.location', { ph: 'Pune, India' })}${F('Headline', rr.basics.headline, 'basics.headline', { ph: 'Frontend Developer' })}</div>
        <div class="grid grid-2">${F('LinkedIn', rr.basics.linkedin, 'basics.linkedin', { ph: 'linkedin.com/in/…' })}${F('GitHub / Portfolio', rr.basics.github, 'basics.github', { ph: 'github.com/…' })}</div>
      `, true),
      section('edit', 'Summary', F('Professional summary', rr.summary, 'summary', { area: true, ph: '2–3 sentences: who you are, your edge, what you want next.' })),
      section('briefcase', 'Experience', listEditor('experience', [
        { label: 'Role', key: 'role', ph: 'Software Engineer Intern' }, { label: 'Company', key: 'company', ph: 'Acme Corp' },
        { label: 'Location', key: 'location', ph: 'Remote' }, { label: 'Start', key: 'start', ph: 'Jun 2025' }, { label: 'End', key: 'end', ph: 'Present' },
        { bullets: true },
      ], 'Experience')),
      section('layers', 'Projects', listEditor('projects', [
        { label: 'Project name', key: 'name', ph: 'Navixa' }, { label: 'Link', key: 'link', ph: 'github.com/…' },
        { label: 'One-line description', key: 'desc', ph: 'Career navigation web app' }, { bullets: true },
      ], 'Project')),
      section('book', 'Education', listEditor('education', [
        { label: 'Degree', key: 'degree', ph: 'B.Tech, Computer Science' }, { label: 'School', key: 'school', ph: 'University name' },
        { label: 'Year', key: 'year', ph: '2022 – 2026' }, { label: 'Score', key: 'score', ph: 'CGPA 8.6/10' },
      ], 'Education')),
      section('zap', 'Skills', `
        <div class="field"><label>Skills <span class="hint">(comma separated)</span></label>
        <textarea class="input" data-k="skillsCsv" placeholder="JavaScript, React, SQL, Figma…">${esc((rr.skills || []).join(', '))}</textarea></div>`),
      section('award', 'Certifications', listEditor('certifications', [
        { label: 'Name', key: 'name', ph: 'AWS Cloud Practitioner' }, { label: 'Issuer', key: 'by', ph: 'Amazon' }, { label: 'Year', key: 'year', ph: '2025' },
      ], 'Certification')),
    ].join('');
    bindForm();
  }

  const commit = debounce(refreshPreview, 250);

  function bindForm() {
    $$('[data-k]', form).forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        patchResume((rr) => {
          if (k === 'skillsCsv') rr.skills = inp.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
          else if (k === 'summary') rr.summary = inp.value;
          else if (k.startsWith('basics.')) rr.basics[k.split('.')[1]] = inp.value;
        });
        commit();
      });
    });
    $$('[data-lk]', form).forEach((inp) => {
      inp.addEventListener('input', () => {
        const [kind, i, key] = inp.dataset.lk.split(':');
        patchResume((rr) => {
          const item = rr[kind][Number(i)]; if (!item) return;
          if (key === 'bullets') item.bullets = inp.value.split('\n').map((x) => x.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          else item[key] = inp.value;
        });
        commit();
      });
    });
    $$('[data-add]', form).forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.add;
      patchResume((rr) => { rr[kind].push(kind === 'experience' ? { role: '', company: '', bullets: [] } : kind === 'projects' ? { name: '', bullets: [] } : {}); });
      renderForm(); refreshPreview();
    }));
    $$('[data-del]', form).forEach((b) => b.addEventListener('click', () => {
      const [kind, i] = b.dataset.del.split(':');
      patchResume((rr) => { rr[kind].splice(Number(i), 1); });
      renderForm(); refreshPreview();
    }));
  }

  /* toolbar actions */
  root.addEventListener('click', (e) => {
    const tpl = e.target.closest('[data-tpl]');
    if (tpl) {
      patchResume((rr) => { rr.template = tpl.dataset.tpl; });
      $$('#tpl-tabs .tab', root).forEach((t) => t.classList.toggle('active', t === tpl));
      refreshPreview();
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'print') { logActivity('resume_edit'); printResume(); }
    if (act.dataset.act === 'tailor') {
      import('./tailor-ui.js').then(({ openTailor }) => openTailor(null, () => { renderForm(); refreshPreview(); }));
    }
    if (act.dataset.act === 'letter') {
      import('./tailor-ui.js').then(({ openCoverLetter }) => openCoverLetter(null));
    }
    if (act.dataset.act === 'export') {
      const blob = new Blob([JSON.stringify(getResume(), null, 2)], { type: 'application/json' });
      const a = el(`<a download="navixa-resume.json" href="${URL.createObjectURL(blob)}"></a>`);
      document.body.appendChild(a); a.click(); a.remove();
      toast('Resume JSON downloaded');
    }
    if (act.dataset.act === 'import') {
      const inp = el('<input type="file" accept=".json,application/json,.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>');
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        const nm = (file.name || '').toLowerCase();
        try {
          if (nm.endsWith('.json') || file.type === 'application/json') {
            const j = JSON.parse(await file.text());
            if (!j.basics) throw new Error('bad file');
            patchResume((rr) => Object.assign(rr, j));
            renderForm(); refreshPreview(); toast('Resume imported');
          } else {
            toast('Reading your resume…');
            const { importResumeFromFile } = await import('./resume-import.js');
            const parsed = await importResumeFromFile(file);
            patchResume((rr) => mergeResume(rr, parsed));
            renderForm(); refreshPreview(); logActivity('resume_edit');
            toast('Resume imported — review the details before downloading');
          }
        } catch (err) {
          const msg = err && err.message && /PDF|Word|JSON|readable|scanned|connection|document/i.test(err.message)
            ? err.message : 'Could not read that file';
          toast(msg, 'warn');
        }
      };
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 2000);
    }
  });
  $('#rp-accent', root).addEventListener('input', (e) => { patchResume((rr) => { rr.accent = e.target.value; }); refreshPreview(); });

  renderForm();
  refreshPreview();
  return root;
}

export function resumePlainText() {
  const r = getResume(); const b = r.basics;
  const lines = [b.name, b.headline, [b.email, b.phone, b.location].filter(Boolean).join(' | '), ''];
  if (r.summary) lines.push('SUMMARY', r.summary, '');
  if (r.experience?.length) { lines.push('EXPERIENCE'); r.experience.forEach((e) => { lines.push(`${e.role} — ${e.company} (${e.start || ''}–${e.end || 'Present'})`); (e.bullets || []).forEach((bl) => lines.push(`• ${bl}`)); }); lines.push(''); }
  if (r.projects?.length) { lines.push('PROJECTS'); r.projects.forEach((p) => { lines.push(`${p.name}${p.desc ? ' — ' + p.desc : ''}`); (p.bullets || []).forEach((bl) => lines.push(`• ${bl}`)); }); lines.push(''); }
  if (r.education?.length) { lines.push('EDUCATION'); r.education.forEach((e) => lines.push(`${e.degree} — ${e.school} (${e.year || ''})`)); lines.push(''); }
  if (r.skills?.length) lines.push('SKILLS', r.skills.join(', '));
  return lines.join('\n');
}
