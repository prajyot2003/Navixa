// Navixa — interview prep UI: question sets per job + spoken practice with feedback.
import { $, $$, el, esc, icon, modal, toast, skeleton } from './utils.js';
import { getState } from './store.js';
import { logActivity } from './gamify.js';
import { questionsForJob, answerFeedback, deliveryStats, speechSupported, startDictation } from './interview.js';

const savedJobs = () => Object.values({ ...getState().jobs.saved, ...getState().jobs.custom });

function pickerHtml() {
  const jobs = savedJobs();
  return `${jobs.length ? `<div class="field"><label>Prepare for a saved job</label>
      <select class="select" data-job><option value="">— choose —</option>
      ${jobs.map((j) => `<option value="${esc(j.id)}">${esc(j.title)} — ${esc(j.company)}</option>`).join('')}</select></div>
    <p class="muted" style="margin:6px 0 12px">…or paste a job description below.</p>`
    : '<p class="sub">Paste the job description you\'re interviewing for. (Saved jobs appear here as a dropdown.)</p>'}
    <div class="field"><label>Job description</label>
      <textarea class="input" data-jd rows="6" placeholder="Paste the posting — responsibilities, requirements, tech stack…"></textarea></div>`;
}

function readPicker(root) {
  const sel = $('[data-job]', root);
  const jd = ($('[data-jd]', root)?.value || '').trim();
  if (sel?.value) {
    const job = savedJobs().find((j) => String(j.id) === sel.value);
    if (job) return jd ? { ...job, description: `${job.description || ''}\n${jd}` } : job;
  }
  if (jd.length >= 40) return { id: 'pasted', title: 'this role', company: 'the company', description: jd, tags: [] };
  return null;
}

/* ================= question set ================= */
export function openInterviewPrep(job = null) {
  const body = el(`<div>${job ? '' : pickerHtml()}<div data-out></div></div>`);
  const out = $('[data-out]', body);

  const run = async (target) => {
    out.innerHTML = `<p class="sub">${icon('sparkles', 15)} Working out what they'll ask you…</p>${skeleton(3)}`;
    const { questions, source } = await questionsForJob(target);
    const byCat = {};
    for (const q of questions) (byCat[q.category] = byCat[q.category] || []).push(q);

    out.innerHTML = `
      <p class="sub">${questions.length} likely questions for <b>${esc(target.title || 'this role')}</b>${
        source === 'generic' ? ' <span class="muted">(AI unavailable — showing a solid general set)</span>' : ''}</p>
      ${Object.entries(byCat).map(([cat, list]) => `
        <div class="field"><label>${esc(cat)}</label>
          ${list.map((q) => `<div class="q-item">
            <div class="q-text">${esc(q.q)}</div>
            ${q.why ? `<div class="muted">${icon('info', 12)} ${esc(q.why)}</div>` : ''}
            ${q.hint ? `<div class="q-hint">${icon('check', 12)} ${esc(q.hint)}</div>` : ''}
            <button class="btn btn-soft btn-sm" data-practice="${esc(q.q)}">${icon('mic', 14)} Practise this</button>
          </div>`).join('')}
        </div>`).join('')}
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" data-copy>${icon('copy', 15)} Copy all</button>
      </div>`;

    $$('[data-practice]', out).forEach((b) => b.onclick = () => openPractice({ question: b.dataset.practice, job: target }));
    $('[data-copy]', out).onclick = async () => {
      const text = questions.map((q, i) => `${i + 1}. [${q.category}] ${q.q}${q.hint ? `\n   → ${q.hint}` : ''}`).join('\n\n');
      try { await navigator.clipboard.writeText(text); toast('Questions copied'); }
      catch { toast('Could not copy — select the text manually', 'warn'); }
    };
    logActivity('mock_interview');
  };

  const m = modal({
    title: job ? `Interview prep — ${job.title}` : 'Interview prep',
    body,
    wide: true,
    actions: job ? [{ label: 'Close' }] : [
      { label: 'Close' },
      {
        label: 'Generate questions',
        primary: true,
        onClick: (root) => {
          const t = readPicker(root);
          if (!t) { toast('Pick a saved job or paste the description', 'warn'); return false; }
          run(t);
          return false;
        },
      },
    ],
  });
  if (job) run(job);
  return m;
}

/* ================= spoken practice ================= */
export function openPractice({ question, job } = {}) {
  const canSpeak = speechSupported();
  const body = el(`<div>
    <div class="prac-q">${icon('help', 16)} <b>${esc(question)}</b></div>
    ${canSpeak ? '' : `<p class="muted">${icon('info', 13)} Voice input needs Chrome or Edge — you can still type your answer below and get feedback.</p>`}
    <div class="row" style="gap:8px;align-items:center;margin:12px 0">
      ${canSpeak ? `<button class="btn btn-primary btn-sm" data-rec>${icon('mic', 15)} Start answering</button>` : ''}
      <span class="prac-timer" data-timer>0:00</span>
      <span class="muted" data-live></span>
    </div>
    <div class="field"><label>Your answer <span class="hint">${canSpeak ? '(speak or type — aim for 60–90 seconds)' : '(type your answer)'}</span></label>
      <textarea class="input" data-answer rows="7" placeholder="${canSpeak ? 'Press “Start answering” and speak — your words appear here.' : 'Type your answer…'}"></textarea></div>
    <div class="row" style="gap:8px">
      <button class="btn btn-primary btn-sm" data-score>${icon('sparkles', 15)} Get feedback</button>
      <button class="btn btn-ghost btn-sm" data-clear>${icon('refresh', 15)} Reset</button>
    </div>
    <div data-fb></div>
  </div>`);

  const answerEl = $('[data-answer]', body);
  const timerEl = $('[data-timer]', body);
  const liveEl = $('[data-live]', body);
  const fb = $('[data-fb]', body);
  let ctrl = null, t0 = 0, tick = null, elapsed = 0;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function stopRec() {
    ctrl?.stop(); ctrl = null;
    clearInterval(tick); tick = null;
    liveEl.textContent = '';
    const b = $('[data-rec]', body);
    if (b) { b.innerHTML = `${icon('mic', 15)} Start answering`; b.classList.remove('btn-danger'); b.classList.add('btn-primary'); }
  }

  $('[data-rec]', body)?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (ctrl) { stopRec(); return; }
    try {
      t0 = Date.now();
      tick = setInterval(() => { elapsed = (Date.now() - t0) / 1000; timerEl.textContent = fmt(elapsed); }, 250);
      ctrl = startDictation({
        onUpdate: (final, interim) => {
          answerEl.value = final;
          liveEl.textContent = interim ? `…${interim.slice(-60)}` : '';
        },
        onEnd: () => { stopRec(); },
        onError: (err) => { toast(err.message, 'warn'); stopRec(); },
      });
      b.innerHTML = `${icon('x', 15)} Stop`;
      b.classList.remove('btn-primary'); b.classList.add('btn-danger');
    } catch (err) { toast(err.message, 'warn'); stopRec(); }
  });

  $('[data-clear]', body).onclick = () => {
    stopRec(); answerEl.value = ''; fb.innerHTML = ''; elapsed = 0; timerEl.textContent = '0:00';
  };

  $('[data-score]', body).onclick = async () => {
    stopRec();
    const text = answerEl.value.trim();
    if (text.length < 20) { toast('Give a fuller answer first', 'warn'); return; }
    fb.innerHTML = skeleton(2);
    const seconds = elapsed || Math.max(20, (text.split(/\s+/).length / 140) * 60);
    const res = await answerFeedback({ question, transcript: text, job });
    const d = deliveryStats(text, seconds);
    fb.innerHTML = `
      <div class="card mt-2">
        <div class="row" style="gap:14px;align-items:center">
          <div class="match-ring" style="--pct:${res.score}"><span>${res.score}</span></div>
          <div style="min-width:0">
            <b>Answer feedback</b>
            <p class="muted" style="margin:2px 0 0">${res.source === 'ai' ? 'Reviewed by AI' : 'Structural review (AI unavailable)'}</p>
          </div>
        </div>
        <div class="prac-metrics">
          <span><b>${d.words}</b> words</span>
          <span><b>${d.wpm}</b> wpm</span>
          <span><b>${d.fillerRate}%</b> filler</span>
          <span>${esc(fmt(d.seconds))}</span>
        </div>
        <p class="sub">${esc(d.verdict)}</p>
        ${d.fillers.length ? `<p class="muted">Most used: ${d.fillers.map((f) => `“${esc(f.word)}” ×${f.count}`).join(', ')}</p>` : ''}
        ${res.strengths.length ? `<div class="field"><label>What worked</label><ul class="fb-list">${res.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${res.improve.length ? `<div class="field"><label>What to sharpen</label><ul class="fb-list">${res.improve.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${res.star ? `<p class="sub">${icon('target', 13)} ${esc(res.star)}</p>` : ''}
      </div>`;
    logActivity('mock_interview');
  };

  return modal({
    title: 'Practise your answer',
    body,
    wide: true,
    actions: [{ label: 'Done' }],
    onClose: () => stopRec(),
  });
}
