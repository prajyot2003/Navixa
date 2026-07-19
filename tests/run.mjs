// Navixa test harness — jsdom smoke + unit tests (run: node tests/run.mjs from project root with jsdom installed)
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head><meta name="theme-color"></head><body><div id="app"></div></body></html>', {
  url: 'https://navixa.test/#/',
  pretendToBeVisual: true,
});
const { window } = dom;

// --- globals the app expects ---
for (const k of ['HTMLElement', 'Node', 'CustomEvent', 'Event', 'getComputedStyle']) globalThis[k] = window[k];
globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => { try { fn(Date.now()); } catch (e) { console.error('rAF cb', e); } }, 8);
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};
const sess = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sess.has(k) ? sess.get(k) : null),
  setItem: (k, v) => sess.set(k, String(v)),
  removeItem: (k) => sess.delete(k),
  clear: () => sess.clear(),
};
window.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
window.HTMLElement.prototype.animate = function () { return { onfinish: null }; };
window.scrollTo = () => {};
window.print = () => { globalThis.__printed = true; };

// --- fetch mock with fixtures ---
const FIXTURES = {
  remotive: { jobs: [{ id: 1, title: 'Senior React Developer', company_name: 'Acme', company_logo: '', candidate_required_location: 'Worldwide', job_type: 'full_time', salary: '', url: 'https://remotive.com/j/1', publication_date: '2026-07-10T00:00:00', tags: ['react', 'javascript'], category: 'Software Development', description: '<p>Build UIs with React and TypeScript for a global product team.</p>' }] },
  jobicy: { jobs: [{ id: 2, jobTitle: 'Python Data Analyst', companyName: 'DataCo', companyLogo: '', jobIndustry: ['Data Science'], jobType: ['full-time'], jobGeo: 'Remote', jobLevel: 'Entry', jobExcerpt: 'Analyze data with Python and SQL dashboards.', url: 'https://jobicy.com/j/2', pubDate: '2026-07-12T00:00:00' }] },
  arbeitnow: { data: [{ slug: 'x1', company_name: 'BerlinTech', title: 'Frontend Engineer Intern', description: '<p>JavaScript internship in Berlin</p>', remote: false, url: 'https://arbeitnow.com/j/x1', tags: ['javascript'], job_types: ['internship'], location: 'Berlin', created_at: 1780000000, visa_sponsorship: true }] },
  muse: { results: [{ id: 3, name: 'Software Engineering Intern', company: { name: 'MegaCorp' }, locations: [{ name: 'Flexible / Remote' }], levels: [{ name: 'Internship' }], categories: [{ name: 'Software Engineering' }], refs: { landing_page: 'https://themuse.com/j/3' }, contents: '<p>Internship building python services</p>', publication_date: '2026-07-11T00:00:00' }] },
  devto: [{ id: 9, title: 'Learn React in 2026', description: 'Guide', url: 'https://dev.to/a', cover_image: '', reading_time_minutes: 6, positive_reactions_count: 42, tag_list: ['react'], published_timestamp: '2026-07-01', user: { name: 'Dev Author' } }],
};
let lastLlmBody = null;
globalThis.fetch = window.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (data, ct = 'application/json') => ({
    ok: true, status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : null) },
    json: async () => data, text: async () => JSON.stringify(data),
    body: null,
  });
  if (u.includes('remotive.com')) return json(FIXTURES.remotive);
  if (u.includes('jobicy.com')) return json(FIXTURES.jobicy);
  if (u.includes('arbeitnow.com')) return json(FIXTURES.arbeitnow);
  if (u.includes('themuse.com')) return json(FIXTURES.muse);
  if (u.includes('dev.to')) return json(FIXTURES.devto);
  if (u.includes('/api/videos') || u.includes('piped')) return json({ items: [{ id: 'abc123', title: 'React Tutorial', by: 'Chan', duration: '12:00', views: 1000, thumb: '', url: 'https://youtube.com/watch?v=abc123' }] });
  if (u.includes('chat/completions') || u.includes('/api/llm')) {
    lastLlmBody = JSON.parse(opts.body || '{}');
    return json({ choices: [{ message: { content: 'pong — hello from mock LLM' } }] });
  }
  if (u.includes('accounts.google.com')) return json({});
  throw new Error(`unmocked fetch: ${u}`);
};

// --- tiny test runner ---
let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch((e) => { fail++; failures.push([name, e]); console.log(`  ✗ ${name}\n    ${e.stack?.split('\n')[0] || e}`); });
}
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected=${JSON.stringify(b)} got=${JSON.stringify(a)}`); };
const ok = (v, msg = '') => { if (!v) throw new Error(`${msg} (falsy: ${JSON.stringify(v)})`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('— unit: store —');
const store = await import('../js/store.js');
await t('signIn creates user + default state', () => {
  store.signIn({ sub: 'demo-test', provider: 'demo', name: 'Testy', email: '' });
  ok(store.currentUser()?.name === 'Testy');
  ok(store.getState().profile.skills.length === 0);
});
await t('update persists + deepMerge survives reload', () => {
  store.update((s) => { s.profile.skills = ['JavaScript', 'React']; s.profile.targetRole = 'Frontend Developer'; });
  store.loadUserData();
  eq(store.getState().profile.skills.length, 2);
  eq(store.getState().profile.targetRole, 'Frontend Developer');
  ok(store.getState().settings.sources.remotive === true, 'defaults merged');
});
await t('export/import round-trip', () => {
  const dump = store.exportAll();
  store.update((s) => { s.profile.targetRole = 'CHANGED'; });
  store.importAll(dump);
  eq(store.getState().profile.targetRole, 'Frontend Developer');
});

console.log('— unit: gamify —');
const gam = await import('../js/gamify.js');
const { todayKey } = await import('../js/utils.js');
await t('levels math', () => {
  eq(gam.levelFromXp(0), 1); eq(gam.levelFromXp(99), 1); eq(gam.levelFromXp(100), 2);
  ok(gam.xpForLevel(2) === 300);
});
await t('logActivity adds xp + day + goal', () => {
  const before = store.getState().gamify.xp;
  gam.logActivity('job_save');
  const g = store.getState().gamify;
  ok(g.xp >= before + 8 + 10, 'xp includes goal bonus'); // job_save(8) + goal_done(10)
  eq(g.activity[todayKey()], 1);
  ok(store.getState().gamify.goals[todayKey()].search === true);
});
await t('streak: consecutive days', () => {
  const d1 = new Date(); d1.setDate(d1.getDate() - 1);
  const d2 = new Date(); d2.setDate(d2.getDate() - 2);
  store.update((s) => { s.gamify.activity[todayKey(d1)] = 2; s.gamify.activity[todayKey(d2)] = 1; });
  eq(gam.computeStreak(), 3);
});
await t('achievement awarding', () => {
  store.update((s) => { s.profile.onboarded = true; });
  gam.checkAchievements();
  ok(store.getState().gamify.achievements['first-steps'], 'first-steps earned');
});

console.log('— unit: api (jobs/articles/match) —');
const api = await import('../js/api.js');
await t('searchJobs aggregates + normalizes + dedupes', async () => {
  const { items, failed } = await api.searchJobs({ q: 'react', force: true });
  eq(failed.length, 0, 'no failed sources');
  eq(items.length, 4, '4 sources → 4 jobs');
  const r = items.find((j) => j.source === 'remotive');
  ok(r && r.remote === true && r.tags.includes('react'));
  const a = items.find((j) => j.source === 'arbeitnow');
  ok(a.visa === true, 'visa flag');
});
await t('filterJobs: internship filter + query', async () => {
  const { items } = await api.searchJobs({ force: true });
  const interns = api.filterJobs(items, { type: 'internship' });
  eq(interns.length, 2, 'two internships');
  const reactOnly = api.filterJobs(items, { q: 'react developer' });
  ok(reactOnly.length >= 1 && reactOnly[0].title.includes('React'));
});
await t('matchJobs scores against profile', async () => {
  const { items } = await api.searchJobs({ force: true });
  const matches = api.matchJobs(items, { skills: ['React', 'JavaScript'], interests: ['Web Development'], targetRole: 'Frontend Developer', role: 'student', openTo: { remote: true } });
  ok(matches.length >= 2);
  ok(matches[0].job.title.match(/React|Frontend/), 'react job ranks first: ' + matches[0].job.title);
  ok(matches[0].pct > 10 && matches[0].pct <= 98);
  ok(matches[0].matched.length > 0, 'matched chips');
});
await t('articles + videos + courses', async () => {
  const arts = await api.searchArticles('react');
  eq(arts.length, 1); eq(arts[0].kind, 'article');
  const vids = await api.searchVideos('react');
  ok(vids.length === 1 && vids[0].kind === 'video');
  const courses = api.curatedCourses('react frontend', []);
  ok(courses.length > 0 && courses.some((c) => /freeCodeCamp|Odin/.test(c.title)));
});
await t('llmChat returns text via mock + system prompt has profile', async () => {
  const text = await api.llmChat([{ role: 'user', content: 'ping' }]);
  ok(/pong/.test(text));
  ok(lastLlmBody.model, 'model set');
  const sys = api.systemPrompt('copilot');
  ok(sys.includes('Frontend Developer'), 'target role in system prompt');
});

console.log('— unit: resume —');
const resume = await import('../js/resume.js');
await t('atsScore: empty resume scores low with tips', () => {
  const r = resume.defaultResume({ name: 'T', email: '' }, {});
  const { score, checks } = resume.atsScore(r, {});
  ok(score < 40, `low score, got ${score}`);
  ok(checks.some((c) => !c.pass && c.tip));
});
await t('atsScore: strong resume scores 80+', () => {
  const r = {
    basics: { name: 'Testy', email: 't@x.com', phone: '+91 90000', location: 'Pune', linkedin: 'li/in/t', headline: 'Frontend Developer' },
    summary: 'Frontend developer with 3 years building React apps used by 200k users. Passionate about performance and design systems. Seeking senior frontend role.',
    experience: [{ role: 'Frontend Developer', company: 'Acme', start: '2023', end: 'Present', bullets: ['Built dashboard used by 20,000 users daily', 'Improved page load 45% via code-splitting', 'Led migration to TypeScript across 12 packages'] }],
    education: [{ degree: 'B.Tech CS', school: 'Uni', year: '2022' }],
    projects: [{ name: 'Navixa', bullets: ['Launched career app with 4 API integrations gaining 500 users'] }],
    skills: ['JavaScript', 'React', 'TypeScript', 'CSS', 'Node.js', 'SQL'],
    certifications: [],
  };
  const { score } = resume.atsScore(r, { targetRole: 'Frontend Developer' });
  ok(score >= 80, `expected 80+, got ${score}`);
});
await t('renderResumeHtml escapes + renders sections', () => {
  const r = resume.defaultResume({ name: '<b>X</b>' }, {});
  r.summary = 'Hello';
  const html = resume.renderResumeHtml(r);
  ok(html.includes('&lt;b&gt;X&lt;/b&gt;'), 'name escaped');
  ok(html.includes('Summary'));
});

console.log('— unit: chat md —');
const chat = await import('../js/chat.js');
await t('markdown renderer', () => {
  const html = chat.md('**bold** and `code`\n\n- item one\n- item two\n\n1. first\n2. second');
  ok(html.includes('<strong>bold</strong>'));
  ok(html.includes('<code>code</code>'));
  ok(html.includes('<ul><li>item one</li>'), 'ul: ' + html);
  ok(html.includes('<ol><li>first</li>'), 'ol: ' + html);
  ok(!/<script/.test(chat.md('<script>alert(1)</script>')), 'xss escaped');
  ok(chat.md('## Skills\ntext').includes('<h3>Skills</h3>'), 'heading split');
  ok(chat.md('```js\nlet x=1\n```').includes('<pre><code>let x=1</code></pre>'), 'fenced code');
});

console.log('— smoke: full app boot & navigation —');
// fresh state → login
storage.clear();
store.signOut?.();
const appMod = await import('../js/app.js');
await sleep(30);
await t('boots to login view', () => {
  ok(document.querySelector('.login'), 'login rendered');
  ok(document.querySelector('[data-demo]'), 'demo button present');
});
await t('demo sign-in → onboarding', async () => {
  document.querySelector('[data-name]').value = 'Prajyot';
  document.querySelector('[data-demo]').click();
  await sleep(30);
  ok(document.querySelector('.onboard'), 'onboarding shown');
});
await t('complete onboarding → dashboard renders', async () => {
  // walk the wizard: choose student
  document.querySelector('[data-role="student"]').click();
  await sleep(10);
  document.querySelector('[data-next]').click(); await sleep(10); // step 1 skills
  document.querySelector('.chip-pick').click();
  document.querySelector('[data-next]').click(); await sleep(10); // step 2 interests
  document.querySelector('.chip-pick').click();
  document.querySelector('[data-next]').click(); await sleep(10); // step 3 target
  document.querySelector('[data-target]').value = 'Frontend Developer';
  document.querySelector('[data-finish]').click();
  await sleep(80);
  ok(document.querySelector('.hero-card'), 'dashboard hero visible');
  ok(document.querySelector('.sidebar'), 'sidebar visible');
  ok(document.querySelector('[data-streak]'), 'streak pill');
});
await t('navigate: jobs view renders results from fixtures', async () => {
  window.location.hash = '#/jobs';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(120);
  ok(document.querySelector('.filter-bar'), 'filter bar');
  ok(document.querySelectorAll('.job-card').length >= 3, `job cards: ${document.querySelectorAll('.job-card').length}`);
});
await t('save job → tracker kanban shows it', async () => {
  document.querySelector('.job-card [data-save]').click();
  await sleep(20);
  window.location.hash = '#/tracker';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(50);
  ok(document.querySelectorAll('.kan-card').length === 1, 'one tracked card');
  // move via select
  const sel = document.querySelector('.kan-card [data-move]');
  sel.value = 'applied';
  sel.dispatchEvent(new window.Event('change'));
  await sleep(20);
  ok(store.getState().jobs.board[Object.keys(store.getState().jobs.saved)[0]] === 'applied', 'moved to applied');
});
await t('matches view renders scored suggestions', async () => {
  window.location.hash = '#/matches';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(150);
  ok(document.querySelector('.match-ring'), 'match ring present');
});
await t('resume view: edit → preview updates + print works', async () => {
  window.location.hash = '#/resume';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(60);
  const nameInput = document.querySelector('[data-k="basics.name"]');
  ok(nameInput, 'form rendered');
  nameInput.value = 'Prajyot Kumar';
  nameInput.dispatchEvent(new window.Event('input'));
  await sleep(400);
  ok(document.querySelector('#resume-paper .rp-name').textContent.includes('Prajyot Kumar'), 'live preview updated');
  document.querySelector('[data-act="print"]').click();
  ok(globalThis.__printed, 'window.print called');
  ok(document.querySelector('#print-mount .resume-paper'), 'print mount populated');
});
await t('chat view: send message → mock reply rendered', async () => {
  window.location.hash = '#/chat';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(50);
  const ta = document.querySelector('.chat-input-bar textarea');
  ta.value = 'What skills do I need?';
  document.querySelector('[data-send]').click();
  await sleep(120);
  const bubbles = document.querySelectorAll('.msg.assistant .msg-bubble');
  ok(bubbles.length >= 1, 'assistant bubble');
  ok(bubbles[bubbles.length - 1].textContent.includes('pong'), 'mock reply text');
  ok(store.getState().chat.threads[0].messages.length >= 2, 'history saved');
});
await t('learn view renders videos/articles/courses', async () => {
  window.location.hash = '#/learn';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(150);
  ok(document.querySelectorAll('.media-card').length >= 2, `media cards: ${document.querySelectorAll('.media-card').length}`);
});
await t('streaks view renders heatmap + badges', async () => {
  window.location.hash = '#/streaks';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(50);
  ok(document.querySelectorAll('.heat-cell').length > 100, 'heatmap cells');
  ok(document.querySelectorAll('.badge-card').length >= 14, 'badge gallery');
});
await t('settings + profile + help render', async () => {
  for (const v of ['settings', 'profile', 'help']) {
    window.location.hash = `#/${v}`;
    window.dispatchEvent(new window.Event('hashchange'));
    await sleep(40);
    ok(document.querySelector('.page-head h2'), `${v} rendered`);
  }
  ok(document.querySelectorAll('.faq-item').length >= 8, 'faqs');
});
await t('xp/streak accumulated through session', () => {
  const g = store.getState().gamify;
  ok(g.a >= 0 || true);
  ok(g.xp > 40, `xp now ${g.xp}`);
  ok(gam.computeStreak() >= 1, 'streak alive');
  ok(store.getState().gamify.achievements['first-steps'], 'onboarding achievement');
});
await t('sign out → login again, data isolated per user', async () => {
  document.querySelector('[data-signout]').click();
  await sleep(30);
  ok(document.querySelector('.login'), 'back at login');
  store.signIn({ sub: 'demo-other', provider: 'demo', name: 'Other' });
  ok(store.getState().profile.onboarded === false, 'fresh user has fresh state');
});

console.log('— admin console & feature flags (local mode) —');
const cfgMod = await import('../js/config.js');
await t('runtime config overrides flags/tips/prompts/banner', () => {
  cfgMod.setRuntimeConfig({ flags: { chat: false }, tips: ['Custom tip'], prompts: ['P1'], banner: 'Hello clients' });
  ok(cfgMod.getFlags().chat === false && cfgMod.getFlags().jobs === true, 'flag merge');
  eq(cfgMod.getTips()[0], 'Custom tip');
  eq(cfgMod.getPrompts()[0], 'P1');
  eq(cfgMod.getBanner(), 'Hello clients');
});
await t('statsFor computes level/streak/counters for admin stats', () => {
  const s = store.defaultState();
  s.gamify.xp = 100;
  s.gamify.activity[todayKey()] = 2;
  s.jobs.saved = { a: {} }; s.jobs.board = { a: 'applied' };
  s.learn.done = { x: 1 };
  const st = store.statsFor(s);
  eq(st.level, 2); eq(st.streak, 1); eq(st.stats.saved, 1); eq(st.stats.applied, 1); eq(st.stats.learnDone, 1);
});
await t('clients get no admin nav; #/admin shows setup card in local mode', async () => {
  store.update((st) => { st.profile.onboarded = true; });
  window.location.hash = '#/dashboard';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(80);
  ok(document.querySelector('.hero-card'), 'dashboard for second user');
  ok(!document.querySelector('[data-nav="admin"]'), 'no admin nav item for client');
  ok(document.body.textContent.includes('Hello clients'), 'admin banner visible to client');
  window.location.hash = '#/admin';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(60);
  ok(document.querySelector('.admin-bar'), 'admin route renders');
  ok(document.body.textContent.includes('Backend not connected'), 'local mode shows setup card, no data');
});
await t('feature flag off hides nav item and redirects the route', async () => {
  ok(!document.querySelector('[data-nav="chat"]'), 'chat nav hidden by flag');
  window.location.hash = '#/chat';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(60);
  ok(!document.querySelector('.chat-input-bar'), 'chat view blocked');
  ok(window.location.hash.includes('dashboard'), 'redirected to dashboard: ' + window.location.hash);
  cfgMod.setRuntimeConfig({});
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { failures.forEach(([n, e]) => console.error(`FAIL: ${n}\n${e.stack}`)); process.exit(1); }
