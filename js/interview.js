// Navixa — interview preparation:
//   • question sets generated from a specific posting + the user's resume
//   • speech practice using the browser's built-in Web Speech API (no service, no key)
//
// Speech recognition is only available in Chromium-based browsers today, so every
// entry point checks speechSupported() first and degrades to typed practice.
import { llmChat } from './api.js';
import { getResume, resumePlainText } from './resume.js';
import { getState } from './store.js';

/* ---------- shared ---------- */

// NOTE: never pass an AbortSignal to llmChat — the free gateway stalls on
// abortable requests. Deadlines are enforced with Promise.race instead.
function withTimeout(p, ms, label = 'The AI service took too long — try again.') {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);
}

function extractJson(raw) {
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

const jobText = (job) => [job.title, job.description, (job.tags || []).join(' '), job.category]
  .filter(Boolean).join('\n');

/* ---------- fallback question bank ---------- */

const GENERIC = {
  behavioural: [
    'Walk me through your background and what led you to apply for this role.',
    'Tell me about a project you are genuinely proud of. What was your specific contribution?',
    'Describe a time you disagreed with a teammate. How did you resolve it?',
    'Tell me about something that did not go well. What did you change afterwards?',
    'How do you decide what to work on when everything feels urgent?',
  ],
  technical: [
    'Walk me through how you would approach a problem you have never seen before.',
    'What part of your technical toolkit are you strongest in, and how did you build that depth?',
    'How do you make sure the work you ship is actually correct?',
    'Describe a technical decision you made and the trade-offs you weighed.',
  ],
  role: [
    'Why this company, specifically?',
    'What do you want to be doing in two years, and how does this role fit?',
    'What questions do you have for us?',
  ],
};

function fallbackQuestions(job) {
  const out = [];
  const push = (list, category) => list.forEach((q) => out.push({ q, category, why: '' }));
  push(GENERIC.behavioural, 'Behavioural');
  push(GENERIC.technical, 'Technical');
  push(GENERIC.role, 'Role fit');
  if (job?.title) {
    out.unshift({ q: `What makes you a strong fit for a ${job.title} role?`, category: 'Role fit', why: 'Almost always asked first.' });
  }
  return out;
}

/* ---------- 1. question set for a specific job ---------- */

/**
 * Generate likely interview questions for a posting, informed by the resume.
 * Returns { questions: [{q, category, why, hint}], source: 'ai'|'generic' }
 */
export async function questionsForJob(job) {
  const resume = resumePlainText();
  try {
    const raw = await withTimeout(llmChat([
      {
        role: 'system',
        content: 'You are an experienced interviewer preparing a candidate. Given a job posting and the candidate\'s resume, '
          + 'produce the questions this candidate is most likely to face. Output ONLY minified JSON: '
          + '{"questions":[{"q":"","category":"","why":"","hint":""}]}. '
          + '10-12 questions. "category" is one of: Behavioural, Technical, Role fit, Gap probe. '
          + 'Include at least two "Gap probe" questions targeting weaknesses visible when comparing the resume to the posting. '
          + '"why" = one short sentence on why they will ask it. "hint" = one line on what a strong answer covers. '
          + 'Be specific to this posting and this candidate — no generic filler.',
      },
      { role: 'user', content: `JOB POSTING:\n${jobText(job).slice(0, 4500)}\n\nCANDIDATE RESUME:\n${resume.slice(0, 6000)}` },
    ], { temperature: 0.4 }), 35000);

    const p = extractJson(raw);
    const questions = (Array.isArray(p.questions) ? p.questions : [])
      .map((x) => ({
        q: String(x.q || '').trim(),
        category: String(x.category || 'Behavioural').trim(),
        why: String(x.why || '').trim(),
        hint: String(x.hint || '').trim(),
      }))
      .filter((x) => x.q)
      .slice(0, 14);
    if (!questions.length) throw new Error('empty');
    return { questions, source: 'ai' };
  } catch {
    return { questions: fallbackQuestions(job), source: 'generic' };
  }
}

/* ---------- 2. answer feedback ---------- */

const FILLERS = ['um', 'uh', 'like', 'you know', 'actually', 'basically', 'literally', 'sort of', 'kind of', 'i mean', 'right'];

/**
 * Deterministic delivery metrics — always available, even with no AI.
 * Returns { words, seconds, wpm, fillers:[{word,count}], fillerRate, verdict }
 */
export function deliveryStats(transcript, seconds) {
  const text = String(transcript || '').toLowerCase();
  const words = (text.match(/\b[\w']+\b/g) || []).length;
  const secs = Math.max(1, Math.round(seconds || 0));
  const wpm = Math.round((words / secs) * 60);

  const fillers = FILLERS
    .map((f) => {
      const re = new RegExp(`\\b${f.replace(/ /g, '\\s+')}\\b`, 'g');
      return { word: f, count: (text.match(re) || []).length };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  const fillerTotal = fillers.reduce((a, b) => a + b.count, 0);
  const fillerRate = words ? Math.round((fillerTotal / words) * 100) : 0;

  let verdict = 'Good pace.';
  if (!words) verdict = 'Nothing captured — check your microphone.';
  else if (wpm > 185) verdict = 'Quite fast — slow down so the interviewer can follow.';
  else if (wpm < 105) verdict = 'A little slow — a bit more energy will help.';
  if (words && fillerRate >= 6) verdict += ' Watch the filler words.';

  return { words, seconds: secs, wpm, fillers: fillers.slice(0, 4), fillerTotal, fillerRate, verdict };
}

/**
 * AI critique of the answer's content. Falls back to a structural heuristic.
 * Returns { score, strengths[], improve[], star, source }
 */
export async function answerFeedback({ question, transcript, job }) {
  const stats = deliveryStats(transcript, 60);
  try {
    const raw = await withTimeout(llmChat([
      {
        role: 'system',
        content: 'You are an interview coach. Judge the candidate\'s spoken answer. Output ONLY minified JSON: '
          + '{"score":0,"strengths":[""],"improve":[""],"star":""}. '
          + '"score" 0-100 for content quality. "strengths" max 3, "improve" max 3, each one short sentence. '
          + '"star" = one sentence on whether the answer had a clear situation, action and measurable result. '
          + 'Be direct and specific — quote their words where useful. Never invent facts about the candidate.',
      },
      {
        role: 'user',
        content: `${job ? `ROLE: ${job.title} at ${job.company}\n\n` : ''}QUESTION: ${question}\n\nTHEIR ANSWER:\n${String(transcript).slice(0, 4000)}`,
      },
    ], { temperature: 0.3 }), 30000);
    const p = extractJson(raw);
    const arr = (x) => (Array.isArray(x) ? x : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
    const score = Math.max(0, Math.min(100, Math.round(Number(p.score))));
    return {
      score: Number.isFinite(score) ? score : heuristicScore(transcript),
      strengths: arr(p.strengths),
      improve: arr(p.improve),
      star: String(p.star || '').trim(),
      stats,
      source: 'ai',
    };
  } catch {
    return { ...heuristicFeedback(transcript), stats, source: 'heuristic' };
  }
}

function heuristicScore(t) {
  const words = (String(t).match(/\b[\w']+\b/g) || []).length;
  if (words < 25) return 25;
  if (words < 60) return 45;
  if (words > 400) return 60;
  return 65;
}

function heuristicFeedback(t) {
  const text = String(t);
  const words = (text.match(/\b[\w']+\b/g) || []).length;
  const hasNumbers = /\d/.test(text);
  const hasResult = /\b(result|impact|increased|reduced|improved|saved|grew|shipped|delivered|led to)\b/i.test(text);
  const strengths = [];
  const improve = [];
  if (words >= 80) strengths.push('Good length — you gave the interviewer enough to work with.');
  if (hasNumbers) strengths.push('You included concrete numbers, which makes the story credible.');
  if (hasResult) strengths.push('You described an outcome, not just activity.');
  if (words < 60) improve.push('Too short — add the situation, what you did, and how it turned out.');
  if (words > 400) improve.push('Quite long — tighten it to about 90 seconds.');
  if (!hasNumbers) improve.push('Add a number or measurable result to make the impact concrete.');
  if (!hasResult) improve.push('Finish with the outcome — what changed because of your work?');
  return {
    score: heuristicScore(text),
    strengths: strengths.slice(0, 3),
    improve: improve.slice(0, 3),
    star: hasResult && hasNumbers
      ? 'Reads like a complete STAR answer.'
      : 'Structure it as Situation → Action → Result, ending with a measurable result.',
  };
}

/* ---------- 3. speech recognition wrapper ---------- */

export function speechSupported() {
  return typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Start dictation. Returns a controller: { stop(), abort() }.
 * onUpdate(finalText, interimText) fires as the user speaks.
 */
export function startDictation({ onUpdate, onEnd, onError, lang = 'en-US' } = {}) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) throw new Error('Speech recognition is not supported in this browser.');
  const rec = new Rec();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  let final = '';
  let stopped = false;

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    onUpdate?.(final.trim(), interim.trim());
  };
  rec.onerror = (e) => {
    const map = {
      'not-allowed': 'Microphone access was blocked. Allow it in your browser settings and try again.',
      'no-speech': 'I didn\'t hear anything — check your microphone.',
      'audio-capture': 'No microphone found.',
      network: 'Speech recognition needs a network connection.',
    };
    onError?.(new Error(map[e.error] || `Speech error: ${e.error}`));
  };
  rec.onend = () => {
    // Chrome stops after a pause; restart until the user explicitly stops.
    if (!stopped) { try { rec.start(); return; } catch { /* fall through */ } }
    onEnd?.(final.trim());
  };

  try { rec.start(); } catch (e) { throw new Error('Could not start the microphone.'); }

  return {
    stop() { stopped = true; try { rec.stop(); } catch { onEnd?.(final.trim()); } },
    abort() { stopped = true; try { rec.abort(); } catch { /* ignore */ } },
  };
}
