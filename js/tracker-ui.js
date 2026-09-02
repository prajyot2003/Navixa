// Navixa — tracker insights: funnel analytics, stale-application nudges, exports.
import { $, $$, el, esc, icon, modal, toast, skeleton, safeUrl} from './utils.js';
import { getState } from './store.js';
import {
  analytics, staleApplications, followUpDraft, toCsv, toIcs, download,
  setInterviewDate, interviewDate, trackedJobs, COL_LABEL,
} from './tracker-tools.js';

/* ---------- follow-up composer ---------- */
export function openFollowUp({ id, job, days, col }) {
  const body = el(`<div>
    <p class="sub">${esc(job.title)} at <b>${esc(job.company)}</b> — ${col === 'interview' ? 'interviewed' : 'applied'} ${days} days ago with no update.</p>
    <div data-out>${skeleton(3)}</div></div>`);
  const out = $('[data-out]', body);

  followUpDraft({ job, days, col }).then((text) => {
    out.innerHTML = `
      <div class="field"><label>Draft <span class="hint">(edit before sending)</span></label>
        <textarea class="input" data-text rows="12">${esc(text)}</textarea></div>
      <div class="row" style="gap:8px">
        <button class="btn btn-primary btn-sm" data-copy>${icon('copy', 15)} Copy</button>
        ${job.url ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl(job.url))}" target="_blank" rel="noopener">${icon('external', 15)} Open listing</a>` : ''}
      </div>
      <p class="muted" style="margin-top:8px">${icon('info', 13)} Send from your own email — Navixa never emails on your behalf.</p>`;
    $('[data-copy]', out).onclick = async () => {
      try { await navigator.clipboard.writeText($('[data-text]', out).value); toast('Follow-up copied'); }
      catch { toast('Select the text and copy manually', 'warn'); }
    };
  });

  return modal({ title: 'Follow up', body, wide: true, actions: [{ label: 'Close' }] });
}

/* ---------- interview date + calendar ---------- */
export function openSchedule({ id, job }) {
  const cur = interviewDate(id);
  const body = el(`<div>
    <p class="sub">Set the interview time for <b>${esc(job.title)}</b> at ${esc(job.company)} and add it to your calendar.</p>
    <div class="field"><label>Date &amp; time</label>
      <input class="input" type="datetime-local" data-dt value="${esc(cur)}"></div>
    <div class="field"><label>Length</label>
      <select class="select" data-len>
        <option value="30">30 minutes</option><option value="45">45 minutes</option>
        <option value="60" selected>1 hour</option><option value="90">1.5 hours</option>
      </select></div>
  </div>`);

  return modal({
    title: 'Schedule interview',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save & download .ics',
        primary: true,
        onClick: (root) => {
          const dt = $('[data-dt]', root).value;
          if (!dt) { toast('Pick a date and time first', 'warn'); return false; }
          const minutes = Number($('[data-len]', root)?.value || 60);
          setInterviewDate(id, dt);
          download(`interview-${String(job.company || 'role').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`,
            toIcs(job, dt, { minutes }), 'text/calendar');
          toast('Saved — open the .ics file to add it to your calendar');
        },
      },
    ],
  });
}

/* ---------- insights panel ---------- */
export function insightsPanel(onChanged) {
  const wrap = el('<div class="tracker-insights"></div>');

  function render() {
    const a = analytics();
    const stale = staleApplications();
    const jobs = trackedJobs();
    const stat = (n, label, hint) => `<div class="ins-stat"><b>${n === null ? '—' : n}</b><span>${label}</span>${hint ? `<i>${hint}</i>` : ''}</div>`;
    const maxWeek = Math.max(1, ...a.weeks.map((w) => w.n));

    wrap.innerHTML = `
      <div class="card">
        <div class="card-title">${icon('target')} Your funnel
          <span class="more">
            <button class="btn btn-ghost btn-sm" data-csv>${icon('download', 14)} CSV</button>
          </span></div>
        <div class="ins-stats">
          ${stat(a.applied, 'applied')}
          ${stat(a.interviews, 'interviews', a.responseRate === null ? '' : `${a.responseRate}% response`)}
          ${stat(a.offers, 'offers', a.offerRate === null ? '' : `${a.offerRate}% of applications`)}
          ${stat(a.active, 'in play', a.avgDaysToResponse === null ? '' : `~${a.avgDaysToResponse}d to hear back`)}
        </div>
        ${a.applied >= 3 ? `<div class="ins-weeks">${a.weeks.map((w) => `
          <div class="ins-week" title="${w.n} applied"><i style="height:${Math.round((w.n / maxWeek) * 100)}%"></i><span>${w.label}</span></div>`).join('')}</div>` : ''}
        ${a.sources.length > 1 ? `<div class="field" style="margin-top:10px"><label>Which sources convert</label>
          ${a.sources.slice(0, 4).map((s) => `<div class="gap-row">
            <span class="gap-name">${esc(s.source)}</span>
            <span class="gap-bar"><i style="width:${s.rate || 0}%"></i></span>
            <span class="gap-pct">${s.rate === null ? '—' : s.rate + '%'}</span></div>`).join('')}
          <p class="muted" style="margin-top:4px">Interview rate per source (from ${a.applied} applications).</p></div>` : ''}
        ${a.applied === 0 ? '<p class="muted">Move a card to <b>Applied</b> and your funnel stats will build up here.</p>' : ''}
      </div>

      ${stale.length ? `<div class="card mt-2">
        <div class="card-title">${icon('clock')} Needs a nudge <span class="more muted">${stale.length} waiting</span></div>
        ${stale.slice(0, 5).map((x) => `
          <div class="row nudge-row" data-id="${esc(x.id)}">
            <span style="flex:1;min-width:0">
              <b>${esc(x.job.title)}</b> <span class="muted">· ${esc(x.job.company)}</span><br>
              <span class="muted">${COL_LABEL[x.col]} ${x.days} days ago</span>
            </span>
            <button class="btn btn-soft btn-sm" data-follow>${icon('mail', 14)} Follow up</button>
          </div>`).join('')}
      </div>` : ''}`;

    $('[data-csv]', wrap).onclick = () => {
      if (!Object.keys(jobs).length) { toast('Nothing to export yet', 'warn'); return; }
      download(`navixa-applications-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(), 'text/csv');
      toast('CSV downloaded');
    };
    $$('.nudge-row', wrap).forEach((row) => {
      const item = stale.find((x) => x.id === row.dataset.id);
      $('[data-follow]', row).onclick = () => openFollowUp(item);
    });
  }

  render();
  wrap.refresh = render;
  return wrap;
}
