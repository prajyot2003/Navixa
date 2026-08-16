// Navixa — job-aware career tools:
//   1. tailorToJob()    — gap analysis + rewritten bullets for a specific posting
//   2. coverLetter()    — tailored cover letter from resume + posting
//   3. skillGap()       — skills you're missing, computed from real live listings
//
// Everything degrades gracefully: the LLM calls have deterministic fallbacks so
// the features still return something useful when the free gateway is down.
import { llmChat, searchJobs } from './api.js';
import { getResume, resumePlainText } from './resume.js';
import { getState } from './store.js';

/* ---------- shared helpers ---------- */

// NOTE: never pass an AbortSignal to llmChat — the free gateway stalls on
// abortable requests (see resume-import.js). Enforce deadlines with a race.
function withTimeout(promise, ms, label = 'LLM timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function extractJson(raw) {
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

const STOP = new Set(['the','and','for','with','you','our','are','will','have','this','that','from','your','their','they','has','was','were','all','any','can','who','how','why','not','but','its','into','out','more','most','than','then','them','been','being','also','such','may','must','should','would','could','about','across','within','while','when','where','which','each','other','over','under','per','via','use','using','used','work','working','role','team','teams','years','year','experience','strong','good','great','excellent','ability','able','including','include','includes','well','new','plus','etc','job','candidate','candidates','applicants','position','opportunity','company','looking','join','help','make','build','building','develop','developing','support','ensure','drive','deliver','manage','lead','level','senior','junior','mid','full','time','part','remote','hybrid','onsite','office','salary','benefits','apply','application']);

function tokens(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9+#./ -]/g, ' ')
    .split(/[\s/]+/)
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
    .filter((w) => w.length >= 2 && w.length <= 24 && !STOP.has(w) && !/^\d+$/.test(w));
}

// Skill vocabulary — used to keep extraction focused on real, teachable skills.
const SKILL_HINTS = [
  'javascript','typescript','python','java','c++','c#','go','golang','rust','ruby','php','swift','kotlin','scala','r','matlab','dart',
  'react','angular','vue','svelte','next.js','nextjs','node','node.js','express','django','flask','fastapi','spring','rails','laravel','.net',
  'html','css','sass','scss','tailwind','bootstrap','jquery','redux','graphql','rest','api','apis','websockets',
  'sql','mysql','postgresql','postgres','mongodb','redis','sqlite','oracle','nosql','dynamodb','snowflake','bigquery','databricks',
  'aws','azure','gcp','docker','kubernetes','terraform','jenkins','ci/cd','devops','linux','bash','git','github','gitlab','nginx',
  'pandas','numpy','scikit-learn','sklearn','tensorflow','pytorch','keras','opencv','nlp','llm','machine','learning','deep','ai',
  'tableau','powerbi','power','looker','excel','spreadsheets','statistics','analytics','etl','airflow','spark','hadoop','kafka',
  'figma','sketch','adobe','photoshop','illustrator','ux','ui','wireframing','prototyping','usability','accessibility',
  'agile','scrum','kanban','jira','confluence','testing','jest','cypress','selenium','pytest','junit','tdd',
  'seo','sem','marketing','copywriting','salesforce','hubspot','crm','communication','leadership','stakeholder','presentation',
];
const HINT = new Set(SKILL_HINTS);

function looksLikeSkill(w) {
  return HINT.has(w) || /^[a-z]+\.(js|py|net)$/.test(w) || /\+\+|#$/.test(w);
}

function jobText(job) {
  return [job.title, job.description, (job.tags || []).join(' '), job.category].filter(Boolean).join('\n');
}

/* ================= 1. Tailor resume to a job ================= */

/**
 * Compare the user's resume against one job posting.
 * Returns { score, present[], missing[], bullets[], summary, source }
 *   source: 'ai' | 'keywords'  (so the UI can be honest about what produced it)
 */
export async function tailorToJob(job) {
  const resumeText = resumePlainText();
  const jd = jobText(job);
  const keyword = keywordGaps(resumeText, jd);

  try {
    const raw = await withTimeout(llmChat([
      {
        role: 'system',
        content: 'You are an expert technical recruiter and resume writer. Compare a candidate\'s resume to a job posting. '
          + 'Output ONLY minified JSON, no prose or fences, matching exactly: '
          + '{"score":0,"present":[""],"missing":[""],"bullets":[{"before":"","after":"","why":""}],"summary":""}. '
          + '"score" 0-100 = how well the resume matches THIS posting. '
          + '"present" = important requirements the resume already evidences (max 8). '
          + '"missing" = important requirements absent or weak (max 8). '
          + '"bullets" = up to 4 existing resume bullets rewritten to better match the posting; "before" MUST be copied verbatim from the resume, "after" keeps the same facts but sharpens wording and adds relevant keywords, "why" is one short sentence. '
          + 'Never invent experience, technologies or numbers the candidate does not already claim. '
          + '"summary" = 2 sentences of honest advice.',
      },
      { role: 'user', content: `JOB POSTING:\n${jd.slice(0, 5000)}\n\nCANDIDATE RESUME:\n${resumeText.slice(0, 7000)}` },
    ], { temperature: 0.2 }), 30000);

    const p = extractJson(raw);
    const clean = (arr) => (Array.isArray(arr) ? arr : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
    const bullets = (Array.isArray(p.bullets) ? p.bullets : [])
      .map((b) => ({ before: String(b.before || '').trim(), after: String(b.after || '').trim(), why: String(b.why || '').trim() }))
      .filter((b) => b.before && b.after && b.before !== b.after)
      .slice(0, 4);

    const score = Math.max(0, Math.min(100, Math.round(Number(p.score))));
    return {
      score: Number.isFinite(score) ? score : keyword.score,
      present: clean(p.present).length ? clean(p.present) : keyword.present,
      missing: clean(p.missing).length ? clean(p.missing) : keyword.missing,
      bullets,
      summary: String(p.summary || '').trim(),
      source: 'ai',
    };
  } catch {
    return { ...keyword, bullets: [], summary: '', source: 'keywords' };
  }
}

// Deterministic fallback: pure keyword overlap between resume and posting.
function keywordGaps(resumeText, jd) {
  const have = new Set(tokens(resumeText));
  const counts = new Map();
  for (const w of tokens(jd)) counts.set(w, (counts.get(w) || 0) + 1);

  const ranked = [...counts.entries()]
    .filter(([w]) => looksLikeSkill(w))
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  const present = ranked.filter((w) => have.has(w)).slice(0, 8);
  const missing = ranked.filter((w) => !have.has(w)).slice(0, 8);
  const total = present.length + missing.length;
  const score = total ? Math.round((present.length / total) * 100) : 50;
  return { score, present, missing };
}

/* ================= 2. Cover letter ================= */

export async function coverLetter(job, { tone = 'professional' } = {}) {
  const r = getResume();
  const name = r.basics?.name || getState().profile?.name || '';
  const resumeText = resumePlainText();

  try {
    return (await withTimeout(llmChat([
      {
        role: 'system',
        content: `Write a cover letter for a job application. Tone: ${tone}. Rules: 200-300 words; 3-4 short paragraphs; `
          + 'open with genuine specific interest in THIS role and company (no "I am writing to apply"); '
          + 'evidence claims only with facts already in the resume — never invent experience, employers or numbers; '
          + 'reference 2-3 concrete requirements from the posting; close with a brief call to action. '
          + 'Output only the letter body as plain text. No placeholders like [Company] — use the real names given. '
          + 'Do not include an address block or date.',
      },
      {
        role: 'user',
        content: `CANDIDATE NAME: ${name}\nROLE: ${job.title}\nCOMPANY: ${job.company}\n\nJOB POSTING:\n${jobText(job).slice(0, 4000)}\n\nRESUME:\n${resumeText.slice(0, 6000)}`,
      },
    ], { temperature: 0.6 }), 35000)).trim();
  } catch (e) {
    throw new Error('Could not reach the AI service to write your letter — try again in a moment.');
  }
}

/* ================= 3. Skill gap from live listings ================= */

/**
 * Aggregate the skills that actually appear in current postings for the user's
 * target role, then diff against the skills on their profile + resume.
 * Returns { role, sampled, have[], missing:[{skill,count,pct}], top:[{skill,count,pct}] }
 */
export async function skillGap({ role, limit = 12 } = {}) {
  const s = getState();
  const target = (role || s.profile?.targetRole || '').trim();
  if (!target) throw new Error('Set a target role in your profile first — then I can compare it against live postings.');

  const { items: jobs } = await searchJobs({ q: target });
  if (!jobs?.length) throw new Error(`No live postings found for “${target}” right now. Try a broader role title.`);

  // Count how many DISTINCT postings mention each skill.
  const docFreq = new Map();
  for (const j of jobs) {
    const seen = new Set(tokens(jobText(j)).filter(looksLikeSkill));
    for (const w of seen) docFreq.set(w, (docFreq.get(w) || 0) + 1);
  }

  const have = new Set([
    ...tokens((s.profile?.skills || []).join(' ')),
    ...tokens(resumePlainText()),
  ]);

  const ranked = [...docFreq.entries()]
    .map(([skill, count]) => ({ skill, count, pct: Math.round((count / jobs.length) * 100) }))
    .filter((x) => x.pct >= 8)               // ignore long-tail noise
    .sort((a, b) => b.count - a.count);

  return {
    role: target,
    sampled: jobs.length,
    have: ranked.filter((x) => have.has(x.skill)).slice(0, limit),
    missing: ranked.filter((x) => !have.has(x.skill)).slice(0, limit),
    top: ranked.slice(0, limit),
  };
}
