// Navixa — streaks, XP, levels, achievements, daily goals
import { getState, update, emit } from './store.js';
import { ACHIEVEMENTS, XP_RULES, DAILY_GOALS } from './config.js';
import { todayKey, toast, confetti } from './utils.js';

export function xpForLevel(l) { return 50 * l * (l + 1); } // cumulative xp to REACH level l+1
export function levelFromXp(xp) {
  let l = 0; while (xp >= xpForLevel(l + 1)) l++; return l + 1; // levels start at 1
}
export function levelProgress(xp) {
  const lvl = levelFromXp(xp);
  const prev = xpForLevel(lvl - 1), next = xpForLevel(lvl);
  return { lvl, into: xp - prev, span: next - prev, pct: Math.min(100, Math.round(((xp - prev) / (next - prev)) * 100)) };
}

const GOAL_MAP = {
  learn: ['learn_save', 'learn_complete', 'chat_message'],
  search: ['job_save', 'job_apply', 'job_search'],
  build: ['resume_edit', 'ats_run', 'tracker_move'],
};

export function logActivity(kind, meta = {}) {
  const s = getState(); if (!s) return;
  const xp = XP_RULES[kind] ?? 3;
  const day = todayKey();
  const prevLevel = levelFromXp(s.gamify.xp);
  update((st) => {
    const g = st.gamify;
    g.activity[day] = (g.activity[day] || 0) + 1;
    g.xp += xp;
    if (kind === 'chat_message') g.counters.chat = (g.counters.chat || 0) + 1;
    if (kind === 'mock_interview') g.counters.mock = (g.counters.mock || 0) + 1;
    // daily goals
    const goals = g.goals[day] || (g.goals[day] = {});
    for (const [goal, kinds] of Object.entries(GOAL_MAP)) {
      if (!goals[goal] && kinds.includes(kind)) { goals[goal] = true; g.xp += XP_RULES.goal_done; }
    }
    // streak shields: earn one every 7 days of current streak
    const streak = computeStreak(g.activity);
    if (streak > 0 && streak % 7 === 0 && g.shieldEarnedAtStreak !== streak) {
      g.shields = Math.min(3, (g.shields || 0) + 1);
      g.shieldEarnedAtStreak = streak;
    }
  }, { type: 'gamify', kind });
  const s2 = getState();
  const newLevel = levelFromXp(s2.gamify.xp);
  if (newLevel > prevLevel) {
    toast(`Level up! You reached level ${newLevel}`, 'xp', 4200);
    confetti();
  }
  checkAchievements();
}

export function markVisited(view) {
  const s = getState(); if (!s) return;
  if (!s.gamify.visited[view]) {
    update((st) => { st.gamify.visited[view] = true; }, { type: 'visit' });
    checkAchievements();
  }
}

export function computeStreak(activity = getState()?.gamify.activity || {}) {
  let streak = 0;
  const d = new Date();
  // today counts if active; otherwise streak still alive if yesterday active
  if (!activity[todayKey(d)]) d.setDate(d.getDate() - 1);
  while (activity[todayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

export function streakAliveToday() {
  const a = getState()?.gamify.activity || {};
  return !!a[todayKey()];
}

// If exactly one day was missed and a shield is available, auto-bridge it.
export function applyShieldIfNeeded() {
  const s = getState(); if (!s) return;
  const g = s.gamify;
  if (!g.shields) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const y2 = new Date(); y2.setDate(y2.getDate() - 2);
  const yk = todayKey(y), y2k = todayKey(y2);
  if (!g.activity[yk] && !g.activity[todayKey()] && g.activity[y2k]) {
    update((st) => {
      st.gamify.shields--;
      st.gamify.activity[yk] = 0.5; // shielded day
    }, { type: 'gamify' });
    toast('A streak shield saved your streak!', 'xp', 4200);
  }
}

export function goalsToday() {
  const s = getState();
  const done = s?.gamify.goals[todayKey()] || {};
  return DAILY_GOALS.map((goal) => ({ ...goal, done: !!done[goal.id] }));
}

export function heatmapData(weeks = 22) {
  const s = getState();
  const activity = s?.gamify.activity || {};
  const days = [];
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (weeks * 7 - 1) - end.getDay());
  const cur = new Date(start);
  while (cur <= end) {
    const k = todayKey(cur);
    days.push({ key: k, count: activity[k] || 0, dow: cur.getDay(), date: new Date(cur) });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function achievementList() {
  const got = getState()?.gamify.achievements || {};
  return ACHIEVEMENTS.map((a) => ({ ...a, earned: !!got[a.id], at: got[a.id] }));
}

function award(st, id) {
  if (st.gamify.achievements[id]) return false;
  st.gamify.achievements[id] = Date.now();
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (def?.xp) st.gamify.xp += def.xp;
  return def;
}

export function checkAchievements() {
  const s = getState(); if (!s) return;
  const earned = [];
  update((st) => {
    const g = st.gamify;
    const savedJobs = Object.keys(st.jobs.saved).length + Object.keys(st.jobs.custom).length;
    const applied = Object.values(st.jobs.board).filter((c) => c === 'applied' || c === 'interview' || c === 'offer').length;
    const learnSaved = Object.keys(st.learn.saved).length;
    const learnDone = Object.keys(st.learn.done).length;
    const lvl = levelFromXp(g.xp);
    const streak = computeStreak(g.activity);
    const tests = [
      ['first-steps', st.profile.onboarded],
      ['resume-rookie', !!st.resume],
      ['curious-mind', (g.counters.chat || 0) >= 10],
      ['interview-ready', (g.counters.mock || 0) >= 1],
      ['job-hunter', savedJobs >= 10],
      ['applicant', applied >= 5],
      ['scholar', learnSaved >= 10],
      ['finisher', learnDone >= 5],
      ['week-warrior', streak >= 7],
      ['unstoppable', streak >= 30],
      ['level-5', lvl >= 5],
      ['level-10', lvl >= 10],
      ['explorer', ['dashboard', 'jobs', 'matches', 'resume', 'chat', 'learn', 'streaks', 'tracker'].every((v) => g.visited[v])],
      ['wordsmith', g.bestAts >= 80],
    ];
    for (const [id, ok] of tests) { if (ok) { const def = award(st, id); if (def) earned.push(def); } }
  }, { type: 'gamify' });
  earned.forEach((a, i) => setTimeout(() => { toast(`Achievement unlocked: ${a.name}`, 'xp', 4200); confetti(0.5, 0.25); }, i * 700));
  if (earned.length) emit({ type: 'achievement' });
}

export function recordAts(score) {
  update((st) => { st.gamify.bestAts = Math.max(st.gamify.bestAts || 0, score); }, { type: 'gamify' });
  checkAchievements();
}
