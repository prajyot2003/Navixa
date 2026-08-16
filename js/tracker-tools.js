// Navixa — application tracker intelligence:
//   • stage timestamps (so we can tell how long things have been sitting)
//   • stale-application nudges + AI-drafted follow-up messages
//   • funnel analytics (response rate, per-source performance, weekly volume)
//   • CSV export and .ics calendar files for interviews
import { getState, update } from './store.js';
import { llmChat } from './api.js';

export const COL_LABEL = { saved: 'Saved', applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Closed' };
const DAY = 86400e3;

/* ---------- stage history (added lazily; older data keeps working) ---------- */

export function recordStage(id, col) {
  update((s) => {
    s.jobs.log = s.jobs.log || {};
    s.jobs.log[id] = s.jobs.log[id] || {};
    if (!s.jobs.log[id][col]) s.jobs.log[id][col] = Date.now();
  }, { type: 'jobs' });
}

export function stageLog(id) { return getState().jobs.log?.[id] || {}; }
export const daysSince = (ts) => (ts ? Math.floor((Date.now() - ts) / DAY) : null);

export function trackedJobs() {
  const s = getState();
  return { ...s.jobs.saved, ...s.jobs.custom };
}

/* ---------- interview dates (for calendar export) ---------- */

export function setInterviewDate(id, iso) {
  update((s) => { s.jobs.dates = s.jobs.dates || {}; if (iso) s.jobs.dates[id] = iso; else delete s.jobs.dates[id]; }, { type: 'jobs' });
}
export function interviewDate(id) { return getState().jobs.dates?.[id] || ''; }

/* ---------- stale applications ---------- */

/**
 * Applications sitting in one stage longer than the threshold for that stage.
 * Returns [{ id, job, col, days, ts }] sorted by longest-waiting first.
 */
export function staleApplications({ appliedDays = 7, interviewDays = 10 } = {}) {
  const s = getState();
  const jobs = trackedJobs();
  const out = [];
  for (const [id, job] of Object.entries(jobs)) {
    const col = s.jobs.board?.[id] || 'saved';
    if (col !== 'applied' && col !== 'interview') continue;
    const ts = stageLog(id)[col];
    if (!ts) continue;
    const days = daysSince(ts);
    const limit = col === 'applied' ? appliedDays : interviewDays;
    if (days >= limit) out.push({ id, job, col, days, ts });
  }
  return out.sort((a, b) => b.days - a.days);
}

/* ---------- follow-up message ---------- */

function fallbackFollowUp(job, days, col) {
  const who = job.company || 'the team';
  const role = job.title || 'the role';
  return col === 'interview'
    ? `Subject: Following up — ${role}\n\nHi,\n\nThank you again for the conversation about the ${role} position at ${who}. I enjoyed learning more about the team and the problems you're working on.\n\nI wanted to check in on where things stand in the process, and whether there's anything further I can share to help your decision.\n\nLooking forward to hearing from you.\n\nBest regards`
    : `Subject: Following up on my application — ${role}\n\nHi,\n\nI applied for the ${role} position at ${who} about ${days} days ago, and I wanted to reiterate my interest.\n\nI'd welcome the chance to discuss how my experience lines up with what the team needs. Happy to share anything else that would be useful.\n\nThank you for your time.\n\nBest regards`;
}

export async function followUpDraft({ job, days, col = 'applied' }) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000));
  try {
    // NOTE: no AbortSignal — the free gateway stalls on abortable requests.
    const text = await Promise.race([
      llmChat([
        {
          role: 'system',
          content: 'Write a short, polite follow-up email for a job application. 90-130 words. '
            + 'Start with a "Subject:" line. Be warm but professional, never desperate or pushy. '
            + 'Reiterate interest, add one line of value, and ask about next steps. '
            + 'No placeholders in brackets — if you do not know a name, address it generically. Output only the email.',
        },
        {
          role: 'user',
          content: `Role: ${job.title}\nCompany: ${job.company}\nStage: ${col === 'interview' ? 'interviewed, awaiting decision' : 'applied, no response'}\nDays since: ${days}`,
        },
      ], { temperature: 0.6 }),
      timeout,
    ]);
    return String(text).trim();
  } catch {
    return fallbackFollowUp(job, days, col);
  }
}

/* ---------- analytics ---------- */

export function analytics() {
  const s = getState();
  const jobs = trackedJobs();
  const ids = Object.keys(jobs);
  const col = (id) => s.jobs.board?.[id] || 'saved';

  const counts = { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 };
  for (const id of ids) counts[col(id)] = (counts[col(id)] || 0) + 1;

  // Anyone who reached applied at any point (current column may have moved on).
  const everReached = (stage) => ids.filter((id) => stageLog(id)[stage]).length;
  const applied = Math.max(everReached('applied'), counts.applied + counts.interview + counts.offer + counts.rejected);
  const interviews = Math.max(everReached('interview'), counts.interview + counts.offer);
  const offers = Math.max(everReached('offer'), counts.offer);

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

  // Average days from applying to first interview.
  const gaps = ids
    .map((id) => { const l = stageLog(id); return l.applied && l.interview ? (l.interview - l.applied) / DAY : null; })
    .filter((x) => x != null && x >= 0);
  const avgDaysToResponse = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;

  // Per-source performance.
  const perSource = {};
  for (const id of ids) {
    const src = jobs[id].source || 'manual';
    perSource[src] = perSource[src] || { source: src, applied: 0, interviews: 0 };
    if (stageLog(id).applied || ['applied', 'interview', 'offer', 'rejected'].includes(col(id))) perSource[src].applied++;
    if (stageLog(id).interview || ['interview', 'offer'].includes(col(id))) perSource[src].interviews++;
  }
  const sources = Object.values(perSource).filter((x) => x.applied > 0)
    .map((x) => ({ ...x, rate: pct(x.interviews, x.applied) }))
    .sort((a, b) => b.applied - a.applied);

  // Applications per week over the last 6 weeks.
  const now = Date.now();
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const end = now - (5 - i) * 7 * DAY, start = end - 7 * DAY;
    const n = ids.filter((id) => { const t = stageLog(id).applied; return t && t >= start && t < end; }).length;
    return { n, label: i === 5 ? 'This week' : `${5 - i}w ago` };
  });

  return {
    total: ids.length,
    counts,
    applied,
    interviews,
    offers,
    responseRate: pct(interviews, applied),
    offerRate: pct(offers, applied),
    avgDaysToResponse,
    sources,
    weeks,
    active: counts.applied + counts.interview,
  };
}

/* ---------- exports ---------- */

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv() {
  const s = getState();
  const jobs = trackedJobs();
  const head = ['Title', 'Company', 'Location', 'Stage', 'Source', 'Saved', 'Applied', 'Interview', 'Offer', 'Interview date', 'Notes', 'URL'];
  const fmt = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
  const rows = Object.entries(jobs).map(([id, j]) => {
    const l = stageLog(id);
    return [
      j.title, j.company, j.location || '',
      COL_LABEL[s.jobs.board?.[id] || 'saved'] || 'Saved',
      j.source || 'manual',
      fmt(l.saved), fmt(l.applied), fmt(l.interview), fmt(l.offer),
      interviewDate(id) ? String(interviewDate(id)).replace('T', ' ') : '',
      s.jobs.notes?.[id] || '', j.url || '',
    ].map(csvCell).join(',');
  });
  return [head.join(','), ...rows].join('\n');
}

// Minimal RFC-5545 file. Dates are treated as local time (no TZID) which every
// major calendar app imports correctly for a single event.
export function toIcs(job, isoLocal, { minutes = 60 } = {}) {
  const clean = String(isoLocal).replace(/[-:]/g, '').replace(/\.\d+/, '');
  const start = clean.length === 13 ? `${clean}00` : clean;   // YYYYMMDDTHHmm -> +ss
  const startDate = new Date(isoLocal);
  const end = new Date(startDate.getTime() + minutes * 60000);
  const p = (n) => String(n).padStart(2, '0');
  const endStr = `${end.getFullYear()}${p(end.getMonth() + 1)}${p(end.getDate())}T${p(end.getHours())}${p(end.getMinutes())}00`;
  const esc = (t) => String(t || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Navixa//Application Tracker//EN',
    'BEGIN:VEVENT',
    `UID:navixa-${Date.now()}@navixa`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART:${start}`,
    `DTEND:${endStr}`,
    `SUMMARY:${esc(`Interview — ${job.title} at ${job.company}`)}`,
    `DESCRIPTION:${esc(`${job.title} at ${job.company}${job.url ? `\n${job.url}` : ''}\n\nAdded from Navixa.`)}`,
    job.location ? `LOCATION:${esc(job.location)}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Interview in 1 hour', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
}
