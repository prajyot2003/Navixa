// Navixa — configuration & static data
export const APP = { name: 'Navixa', version: '1.1.0', tagline: 'Navigate your career with confidence' };

// Supabase backend (cloud accounts, roles, admin console). Empty = local-only mode.
export const SUPABASE = {
  url: 'https://qgvpedqdmlflqaxiipqq.supabase.co',
  anonKey: 'sb_publishable_ZoUxTOCTvFNc01fhydN2eQ_Vu2RPs9f', // publishable key — safe in browsers (RLS enforces access)
};

// Global app config pushed by admins (feature flags, banner, content overrides).
let runtime = {};
export function setRuntimeConfig(cfg) { runtime = cfg || {}; }
export function getFlags() {
  return { jobs: true, matches: true, resume: true, chat: true, learn: true, streaks: true, tracker: true, ...(runtime.flags || {}) };
}
export function getBanner() { return String(runtime.banner || '').trim(); }
export function getTips() { return Array.isArray(runtime.tips) && runtime.tips.length ? runtime.tips : TIPS; }
export function getPrompts() { return Array.isArray(runtime.prompts) && runtime.prompts.length ? runtime.prompts : QUICK_PROMPTS; }
export function getCourses() { return Array.isArray(runtime.courses) && runtime.courses.length ? runtime.courses : CURATED_COURSES; }
export function getDefaultModel() { return runtime.llmModel || LLM.defaultModel; }

export const LLM = {
  // Keyless, OpenAI-compatible gateway (free tier ~30 req/min). Open-weight models preferred.
  providers: [
    { id: 'llm7', label: 'LLM7 (keyless)', base: 'https://api.llm7.io/v1', key: '', models: ['gemma3:27b', 'minimax-m2.7', 'codestral-latest'] },
  ],
  proxyEndpoint: '/api/llm',       // serverless fallback (avoids CORS / network hiccups)
  defaultModel: 'gemma3:27b',      // open-source (Google Gemma 3 27B)
  maxHistory: 14,
  temperature: 0.7,
};

export const JOB_SOURCES = {
  remotive: { label: 'Remotive', home: 'https://remotive.com', kind: 'remote' },
  jobicy:   { label: 'Jobicy', home: 'https://jobicy.com', kind: 'remote' },
  arbeitnow:{ label: 'Arbeitnow', home: 'https://www.arbeitnow.com', kind: 'europe' },
  muse:     { label: 'The Muse', home: 'https://www.themuse.com', kind: 'global' },
};

export const ENDPOINTS = {
  remotive: (q) => `https://remotive.com/api/remote-jobs?limit=50${q ? `&search=${encodeURIComponent(q)}` : ''}`,
  jobicy: (q) => `https://jobicy.com/api/v2/remote-jobs?count=50${q ? `&tag=${encodeURIComponent(q)}` : ''}`,
  arbeitnow: () => `https://www.arbeitnow.com/api/job-board-api`,
  muse: (page = 1, opts = {}) => {
    let u = `https://www.themuse.com/api/public/jobs?page=${page}&descending=true`;
    if (opts.internship) u += '&level=Internship';
    return u;
  },
  devto: (q, perPage = 18) => q
    ? `https://dev.to/api/articles?per_page=${perPage}&tag=${encodeURIComponent(slugTag(q))}`
    : `https://dev.to/api/articles?per_page=${perPage}&top=7`,
  devtoSearch: (q, perPage = 18) => `https://dev.to/api/articles/search?per_page=${perPage}&q=${encodeURIComponent(q)}`,
  videos: (q) => `/api/videos?q=${encodeURIComponent(q)}`,
  proxy: (url) => `/api/proxy?url=${encodeURIComponent(url)}`,
};

function slugTag(q) { return String(q).trim().toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, ''); }

// Piped/Invidious instances tried client-side if serverless video search fails
export const VIDEO_FALLBACK_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.adminforge.de',
];

export const SKILL_SUGGESTIONS = [
  'JavaScript','TypeScript','Python','Java','C++','React','Node.js','SQL','HTML/CSS','Git',
  'Data Analysis','Machine Learning','Excel','Figma','UI/UX Design','Communication','Project Management',
  'Marketing','SEO','Content Writing','Sales','Customer Success','Cloud (AWS)','Docker','Kubernetes',
  'Cybersecurity','DevOps','Product Management','Finance','Accounting','Public Speaking','Leadership',
];

export const INTEREST_SUGGESTIONS = [
  'Web Development','Mobile Apps','Artificial Intelligence','Data Science','Cybersecurity','Cloud Computing',
  'Game Development','Blockchain','Robotics','Product Design','Digital Marketing','Entrepreneurship',
  'Fintech','Healthtech','Edtech','Open Source','Research','Consulting','Sustainability','DevOps',
];

export const TIPS = [
  'Tailor your resume for every application — mirror 5–8 keywords from the job description.',
  'Recruiters spend ~7 seconds on a first resume scan. Put your strongest proof in the top third.',
  'Quantify achievements: “Improved load time 40%” beats “Improved performance”.',
  'Referrals get interviews at ~4× the rate of cold applications. Ask for one warm intro this week.',
  'Learning 30 minutes a day compounds to ~180 hours a year — a whole new skill.',
  'Follow up 5–7 days after applying. Polite persistence signals genuine interest.',
  'Practice answers out loud. The STAR format (Situation, Task, Action, Result) keeps you crisp.',
  'Your LinkedIn headline should say what you do and the value you bring, not just a job title.',
  'Apply within 48 hours of a posting going live — early applicants get seen more.',
  'Interview the company too: prepare 3 sharp questions that show you did your homework.',
  'A portfolio with 2 polished projects beats 10 half-finished ones.',
  'Track every application. What gets measured gets improved.',
];

export const CURATED_COURSES = [
  { match: ['web', 'javascript', 'html', 'css', 'frontend', 'react'], title: 'freeCodeCamp — Responsive Web Design', by: 'freeCodeCamp', url: 'https://www.freecodecamp.org/learn/2022/responsive-web-design/', kind: 'Interactive course' },
  { match: ['javascript', 'web', 'frontend', 'react', 'node'], title: 'The Odin Project — Full Stack JavaScript', by: 'The Odin Project', url: 'https://www.theodinproject.com/paths/full-stack-javascript', kind: 'Project path' },
  { match: ['python', 'data', 'machine learning', 'ai'], title: 'CS50x — Introduction to Computer Science', by: 'Harvard', url: 'https://cs50.harvard.edu/x/', kind: 'University course' },
  { match: ['python'], title: 'Python for Everybody', by: 'University of Michigan', url: 'https://www.py4e.com/', kind: 'Free course' },
  { match: ['data', 'sql', 'analysis', 'analytics'], title: 'Google Data Analytics — free materials', by: 'Kaggle Learn', url: 'https://www.kaggle.com/learn', kind: 'Micro-courses' },
  { match: ['machine learning', 'ai', 'deep learning'], title: 'fast.ai — Practical Deep Learning', by: 'fast.ai', url: 'https://course.fast.ai/', kind: 'Free course' },
  { match: ['machine learning', 'ai'], title: 'Hugging Face Learn', by: 'Hugging Face', url: 'https://huggingface.co/learn', kind: 'Free course' },
  { match: ['design', 'ui', 'ux', 'figma', 'product'], title: 'Google UX Design — foundations (audit free)', by: 'Coursera', url: 'https://www.coursera.org/professional-certificates/google-ux-design', kind: 'Certificate (audit)' },
  { match: ['cloud', 'aws', 'devops', 'docker', 'kubernetes'], title: 'AWS Skill Builder — free tier', by: 'AWS', url: 'https://skillbuilder.aws/', kind: 'Free courses' },
  { match: ['cybersecurity', 'security'], title: 'TryHackMe — free rooms', by: 'TryHackMe', url: 'https://tryhackme.com/', kind: 'Hands-on labs' },
  { match: ['marketing', 'seo', 'digital'], title: 'Google Digital Garage — Digital Marketing', by: 'Google', url: 'https://learndigital.withgoogle.com/digitalgarage', kind: 'Certificate' },
  { match: ['interview', 'career', 'algorithms', 'coding'], title: 'NeetCode Roadmap', by: 'NeetCode', url: 'https://neetcode.io/roadmap', kind: 'Interview prep' },
  { match: [], title: 'roadmap.sh — role based roadmaps', by: 'roadmap.sh', url: 'https://roadmap.sh/', kind: 'Learning roadmaps' },
];

export const ACHIEVEMENTS = [
  { id: 'first-steps', icon: 'flag', name: 'First Steps', desc: 'Complete onboarding', xp: 20 },
  { id: 'resume-rookie', icon: 'file', name: 'Resume Rookie', desc: 'Start your resume', xp: 20 },
  { id: 'wordsmith', icon: 'award', name: 'Wordsmith', desc: 'Reach an ATS score of 80+', xp: 50 },
  { id: 'curious-mind', icon: 'message', name: 'Curious Mind', desc: 'Ask the AI 10 questions', xp: 30 },
  { id: 'interview-ready', icon: 'mic', name: 'Interview Ready', desc: 'Do a mock interview session', xp: 40 },
  { id: 'job-hunter', icon: 'briefcase', name: 'Job Hunter', desc: 'Save 10 jobs', xp: 30 },
  { id: 'applicant', icon: 'send', name: 'In the Arena', desc: 'Mark 5 applications sent', xp: 50 },
  { id: 'scholar', icon: 'book', name: 'Scholar', desc: 'Save 10 learning resources', xp: 30 },
  { id: 'finisher', icon: 'check', name: 'Finisher', desc: 'Complete 5 learning items', xp: 40 },
  { id: 'week-warrior', icon: 'flame', name: 'Week Warrior', desc: 'Keep a 7-day streak', xp: 60 },
  { id: 'unstoppable', icon: 'zap', name: 'Unstoppable', desc: 'Keep a 30-day streak', xp: 150 },
  { id: 'level-5', icon: 'star', name: 'Rising Star', desc: 'Reach level 5', xp: 0 },
  { id: 'level-10', icon: 'trophy', name: 'High Flyer', desc: 'Reach level 10', xp: 0 },
  { id: 'explorer', icon: 'compass', name: 'Explorer', desc: 'Visit every section of Navixa', xp: 25 },
];

export const XP_RULES = {
  chat_message: 5, job_save: 8, job_apply: 20, job_search: 2, resume_edit: 6, ats_run: 10,
  learn_save: 8, learn_complete: 15, goal_done: 10, tracker_move: 5, onboarding: 20, mock_interview: 15,
};

export const DAILY_GOALS = [
  { id: 'learn', icon: 'book', label: 'Learn something', hint: 'Save or complete a resource, or ask the AI' },
  { id: 'search', icon: 'briefcase', label: 'Advance your search', hint: 'Search, save or apply to a job' },
  { id: 'build', icon: 'file', label: 'Build your story', hint: 'Edit your resume or update your tracker' },
];

export const QUICK_PROMPTS = [
  'What skills are most in demand for my target role?',
  'Review my profile and suggest 3 career moves',
  'How do I explain a gap in my resume?',
  'Draft a cold outreach message to a recruiter',
  'What salary should I expect for my role and level?',
  'Give me a 30-day plan to become interview-ready',
];

export const INTERVIEW_KICKOFF = 'Start a mock interview for my target role. Ask me one question at a time, wait for my answer, then give brief feedback (what was good, what to improve) before the next question. Begin with a short intro question.';
