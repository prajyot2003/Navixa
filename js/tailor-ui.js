// Navixa — UI for the job-aware tools in tailor.js (tailor resume, cover letter, skill gap).
import { $, $$, el, esc, icon, modal, toast, skeleton } from './utils.js';
import { getState, update } from './store.js';
import { patchResume, getResume } from './resume.js';
import { logActivity } from './gamify.js';
import { tailorToJob, coverLetter, skillGap } from './tailor.js';

const savedJobs = () => Object.values({ ...getState().jobs.saved, ...getState().jobs.custom });

/* ---------- job picker: choose a saved job, or paste a description ---------- */
function pickerHtml() {
  const jobs = savedJobs();
  return `
    ${jobs.length ? `<div class="field">
      <label>Pick a saved job</label>
      <select class="select" data-job>
        <option value="">— choose —</option>
        ${jobs.map((j) => `<option value="${esc(j.id)}">${esc(j.title)} — ${esc(j.company)}</option>`).join('')}
      </select>
    </div>
    <p class="muted" style="margin:6px 0 12px">…or paste a job description below.</p>`
    : '<p class="sub">Paste the job description you\'re applying to. (Tip: save jobs from Job search and they\'ll appear here as a dropdown.)</p>'}
    <div class="field">
      <label>Job description</label>
      <textarea class="input" data-jd rows="7" placeholder="Paste the posting — responsibilities, requirements, tech stack…"></textarea>
    </div>`;
}

// Resolve whatever the user chose into a job-like object.
function readPicker(root) {
  const sel = $('[data-job]', root);
  const jd = ($('[data-jd]', root)?.value || '').trim();
  if (sel?.value) {
    const job = savedJobs().find((j) => String(j.id) === sel.value);
    if (job) return jd ? { ...job, description: `${job.description || ''}\n${jd}` } : job;
  }
  if (jd.length >= 40) {
    return { id: 'pasted', title: 'this role', company: 'the company', description: jd, tags: [] };
  }
  return null;
}

/* ================= Tailor resume to a job ================= */
export function openTailor(job = null, onApplied) {
  const body = el(`<div>${job ? '' : pickerHtml()}<div data-out></div></div>`);
  const out = $('[data-out]', body);

  const run = async (target) => {
    out.innerHTML = `<p class="sub">${icon('sparkles', 15)} Comparing your resume with the posting…</p>${skeleton(3)}`;
    let res;
    try { res = await tailorToJob(target); }
    catch (e) { out.innerHTML = `<p class="sub">⚠️ ${esc(e.message || 'Could not analyse this posting.')}</p>`; return; }
    renderResult(res, target);
    logActivity('resume_edit');
  };

  const renderResult = (res, target) => {
    const chip = (t, on) => `<span class="chip ${on ? 'on' : ''}">${esc(t)}</span>`;
    out.innerHTML = `
      <div class="row" style="gap:14px;align-items:center;margin-bottom:12px">
        <div class="match-ring" style="--pct:${res.score}"><span>${res.score}%</span></div>
        <div style="min-width:0">
          <b>Match with ${esc(target.title || 'this role')}</b>
          <p class="muted" style="margin:2px 0 0">${res.source === 'ai' ? 'Analysed by AI' : 'Keyword analysis (AI unavailable — still accurate on keywords)'}</p>
        </div>
      </div>
      ${res.summary ? `<p class="sub">${esc(res.summary)}</p>` : ''}
      ${res.present.length ? `<div class="field"><label>Already covered</label><div class="row wrap" style="gap:6px">${res.present.map((t) => chip(t, true)).join('')}</div></div>` : ''}
      ${res.missing.length ? `<div class="field"><label>Missing or weak — work these in if they're true for you</label><div class="row wrap" style="gap:6px">${res.missing.map((t) => chip(t, false)).join('')}</div></div>` : ''}
      ${res.bullets.length ? `<div class="field"><label>Suggested bullet rewrites</label>${res.bullets.map((b, i) => `
        <div class="card mb-1" style="padding:12px 14px">
          <p class="muted" style="margin:0 0 4px;text-decoration:line-through">${esc(b.before)}</p>
          <p style="margin:0 0 6px"><b>${esc(b.after)}</b></p>
          ${b.why ? `<p class="muted" style="margin:0 0 8px">${esc(b.why)}</p>` : ''}
          <button class="btn btn-soft btn-sm" data-apply="${i}">${icon('check', 14)} Use this wording</button>
        </div>`).join('')}</div>` : ''}
      <div class="row" style="gap:8px;margin-top:6px">
        <button class="btn btn-ghost btn-sm" data-letter>${icon('edit', 15)} Write a cover letter</button>
      </div>
      <p class="muted" style="margin-top:10px">${icon('info', 13)} Only claim skills you actually have — recruiters check.</p>`;

    $$('[data-apply]', out).forEach((btn) => btn.onclick = () => {
      const b = res.bullets[Number(btn.dataset.apply)];
      if (applyBulletRewrite(b.before, b.after)) {
        btn.outerHTML = `<span class="badge ok">${icon('check', 13)} Applied to your resume</span>`;
        onApplied?.();
      } else {
        toast('Could not find that exact bullet in your resume', 'warn');
      }
    });
    $('[data-letter]', out).onclick = () => openCoverLetter(target);
  };

  const m = modal({
    title: job ? `Tailor resume — ${job.title}` : 'Tailor resume to a job',
    body,
    wide: true,
    actions: job ? [] : [
      { label: 'Close' },
      {
        label: 'Analyse',
        primary: true,
        onClick: (root) => {
          const target = readPicker(root);
          if (!target) { toast('Pick a saved job or paste at least a few lines of the description', 'warn'); return false; }
          run(target);
          return false; // keep the modal open to show results
        },
      },
    ],
  });
  if (job) run(job);
  return m;
}

// Replace a bullet across experience/projects by exact text match.
function applyBulletRewrite(before, after) {
  let hit = false;
  patchResume((rr) => {
    for (const list of [rr.experience || [], rr.projects || []]) {
      for (const item of list) {
        const i = (item.bullets || []).indexOf(before);
        if (i >= 0) { item.bullets[i] = after; hit = true; return; }
      }
    }
  });
  return hit;
}

/* ================= Cover letter ================= */
export function openCoverLetter(job = null) {
  const body = el(`<div>${job ? '' : pickerHtml()}
    <div class="field"><label>Tone</label>
      <select class="select" data-tone>
        <option value="professional">Professional</option>
        <option value="warm and personable">Warm</option>
        <option value="concise and direct">Concise</option>
        <option value="enthusiastic">Enthusiastic</option>
      </select>
    </div>
    <div data-out></div></div>`);
  const out = $('[data-out]', body);

  const run = async (target, tone) => {
    out.innerHTML = `<p class="sub">${icon('sparkles', 15)} Writing your letter…</p>${skeleton(3)}`;
    let text;
    try { text = await coverLetter(target, { tone }); }
    catch (e) { out.innerHTML = `<p class="sub">⚠️ ${esc(e.message)}</p>`; return; }
    out.innerHTML = `
      <div class="field"><label>Your cover letter <span class="hint">(editable)</span></label>
        <textarea class="input" data-text rows="14">${esc(text)}</textarea></div>
      <div class="row" style="gap:8px">
        <button class="btn btn-primary btn-sm" data-copy>${icon('copy', 15)} Copy</button>
        <button class="btn btn-ghost btn-sm" data-dl>${icon('download', 15)} Download .txt</button>
        <button class="btn btn-ghost btn-sm" data-again>${icon('refresh', 15)} Rewrite</button>
      </div>`;
    $('[data-copy]', out).onclick = async () => {
      try { await navigator.clipboard.writeText($('[data-text]', out).value); toast('Cover letter copied'); }
      catch { toast('Select the text and copy manually', 'warn'); }
    };
    $('[data-dl]', out).onclick = () => {
      const blob = new Blob([$('[data-text]', out).value], { type: 'text/plain' });
      const a = el(`<a download="cover-letter-${String(target.company || 'role').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt" href="${URL.createObjectURL(blob)}"></a>`);
      document.body.appendChild(a); a.click(); a.remove();
    };
    $('[data-again]', out).onclick = () => run(target, $('[data-tone]', body).value);
    logActivity('resume_edit');
  };

  const m = modal({
    title: job ? `Cover letter — ${job.title}` : 'Write a cover letter',
    body,
    wide: true,
    actions: job ? [] : [
      { label: 'Close' },
      {
        label: 'Write it',
        primary: true,
        onClick: (root) => {
          const target = readPicker(root);
          if (!target) { toast('Pick a saved job or paste the description', 'warn'); return false; }
          run(target, $('[data-tone]', root).value);
          return false;
        },
      },
    ],
  });
  if (job) {
    run(job, 'professional');
    $('[data-tone]', body).onchange = (e) => run(job, e.target.value);
  }
  return m;
}

/* ================= Skill gap ================= */
export function skillGapPanel() {
  const wrap = el(`<div class="card">
    <div class="card-title">${icon('target')} Skill gap <span class="more muted">what live postings actually ask for</span></div>
    <div data-out><p class="sub">Compare your skills against real job postings for your target role.</p>
      <button class="btn btn-primary btn-sm" data-run>${icon('sparkles', 15)} Analyse my gap</button></div>
  </div>`);
  const out = $('[data-out]', wrap);

  const run = async () => {
    out.innerHTML = `<p class="sub">Reading current postings…</p>${skeleton(2)}`;
    let g;
    try { g = await skillGap(); }
    catch (e) {
      out.innerHTML = `<p class="sub">${esc(e.message)}</p>
        <a class="btn btn-ghost btn-sm" href="#/profile">${icon('user', 15)} Open profile</a>`;
      return;
    }
    const bar = (x) => `<div class="gap-row"><span class="gap-name">${esc(x.skill)}</span>
      <span class="gap-bar"><i style="width:${x.pct}%"></i></span><span class="gap-pct">${x.pct}%</span></div>`;
    out.innerHTML = `
      <p class="sub">Across <b>${g.sampled}</b> live postings for <b>${esc(g.role)}</b>:</p>
      ${g.missing.length ? `<div class="field"><label>Most-requested skills you're missing</label>${g.missing.map(bar).join('')}
        <div class="row wrap" style="gap:6px;margin-top:8px">${g.missing.slice(0, 6).map((x) => `<button class="chip" data-learn="${esc(x.skill)}">${icon('play', 12)} Learn ${esc(x.skill)}</button>`).join('')}</div></div>`
        : '<p class="sub">✅ You already cover the most-requested skills for this role. Nice.</p>'}
      ${g.have.length ? `<div class="field"><label>You already have</label><div class="row wrap" style="gap:6px">${g.have.map((x) => `<span class="chip on">${esc(x.skill)} · ${x.pct}%</span>`).join('')}</div></div>` : ''}
      <button class="btn btn-ghost btn-sm" data-run>${icon('refresh', 15)} Re-run</button>`;
    $$('[data-learn]', out).forEach((b) => b.onclick = () => {
      const input = $('.learn-search input, [data-learn-q]');
      if (input) { input.value = b.dataset.learn; input.dispatchEvent(new Event('input', { bubbles: true })); }
      window.dispatchEvent(new CustomEvent('navixa:learn-search', { detail: b.dataset.learn }));
      toast(`Searching lessons for ${b.dataset.learn}`);
    });
    $('[data-run]', out).onclick = run;
    logActivity('chat_message');
  };

  $('[data-run]', out).onclick = run;
  return wrap;
}
