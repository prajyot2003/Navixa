// Navixa — AI career chat (threads, modes, streaming)
import { getState, update } from './store.js';
import { $, $$, el, esc, icon, uid, toast } from './utils.js';
import { llmChat, systemPrompt, llmConfig } from './api.js';
import { logActivity } from './gamify.js';
import { getPrompts, INTERVIEW_KICKOFF } from './config.js';
import { resumePlainText } from './resume.js';

const MODES = [
  { id: 'copilot', icon: 'compass', label: 'Career Copilot' },
  { id: 'interview', icon: 'mic', label: 'Interview Coach' },
  { id: 'resume', icon: 'file', label: 'Resume Reviewer' },
];

// Minimal safe markdown → HTML (block-based; safe on streamed partial text)
export function md(src) {
  const pres = [];
  let t = esc(src).replace(/```(?:\w+)?\n?([\s\S]*?)(?:```|$)/g, (_, code) => {
    pres.push(code.replace(/\s+$/, ''));
    return `\x00PRE${pres.length - 1}\x00`;
  });
  t = t.replace(/^(#{1,4}\s.+)$/gm, '\n$1\n'); // headings become their own blocks
  const inline = (s) => s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t.split(/\n{2,}/).map((block) => {
    const b = block.trim();
    if (!b) return '';
    const pre = b.match(/^\x00PRE(\d+)\x00$/);
    if (pre) return `<pre><code>${pres[Number(pre[1])]}</code></pre>`;
    const h = b.match(/^(#{1,4})\s+(.+)$/);
    if (h) return `<h3>${inline(h[2])}</h3>`;
    const lines = b.split('\n');
    const isUl = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    const isOl = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
    if (isUl) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (isOl) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map((l) => {
      const li = l.match(/^\s*[-*•]\s+(.*)$/);
      return li ? `• ${inline(li[1])}` : inline(l);
    }).join('<br>')}</p>`;
  }).join('');
}

function threads() { return getState().chat.threads; }
function activeThread() {
  const c = getState().chat;
  return c.threads.find((t) => t.id === c.activeId) || null;
}
function newThread(mode = 'copilot') {
  const t = { id: uid(), mode, title: 'New conversation', at: Date.now(), messages: [] };
  update((s) => { s.chat.threads.unshift(t); s.chat.activeId = t.id; }, { type: 'chat' });
  return t;
}

export function chatView({ autoMode } = {}) {
  const root = el('<div></div>');
  if (!threads().length) newThread();
  if (autoMode) {
    const t = newThread(autoMode);
    if (autoMode === 'interview') t.pending = INTERVIEW_KICKOFF;
  }
  let busy = false;
  let abort = null;

  root.innerHTML = `
    <div class="page-head">
      <div><h2>AI career chat</h2><p class="lede">Job market questions, interview practice, resume feedback — powered by a free open-source model (${esc(llmConfig().model)}).</p></div>
      <button class="btn btn-ghost" data-new>${icon('plus', 17)} New chat</button>
    </div>
    <div class="chat-layout">
      <div class="chat-side"></div>
      <div class="chat-main">
        <div class="mode-pills"></div>
        <div class="chat-scroll"></div>
        <div class="prompt-chips"></div>
        <div class="chat-input-bar">
          <textarea class="input" rows="1" placeholder="Ask anything about your career, the job market, interviews…" aria-label="Message"></textarea>
          <button class="btn btn-primary" data-send aria-label="Send">${icon('send', 18)}</button>
        </div>
      </div>
    </div>`;

  const sideEl = $('.chat-side', root);
  const scrollEl = $('.chat-scroll', root);
  const inputEl = $('textarea', root);
  const modesEl = $('.mode-pills', root);
  const chipsEl = $('.prompt-chips', root);

  function renderSide() {
    sideEl.innerHTML = threads().map((t) => `
      <button class="thread-item ${t.id === getState().chat.activeId ? 'active' : ''}" data-t="${t.id}">
        <b>${esc(t.title)}</b><span>${MODES.find((m) => m.id === t.mode)?.label || ''} · ${t.messages.length} msgs</span>
      </button>`).join('');
    $$('.thread-item', sideEl).forEach((b) => b.onclick = () => {
      update((s) => { s.chat.activeId = b.dataset.t; }, { type: 'chat' });
      renderAll();
    });
  }

  function renderModes() {
    const t = activeThread();
    modesEl.innerHTML = MODES.map((m) => `<button class="chip ${t?.mode === m.id ? 'on' : ''}" data-m="${m.id}">${icon(m.icon, 14)} ${m.label}</button>`).join('')
      + `<button class="chip" data-del-thread title="Delete conversation">${icon('trash', 14)} Delete</button>`;
    $$('[data-m]', modesEl).forEach((b) => b.onclick = () => {
      update((s) => { const th = s.chat.threads.find((x) => x.id === s.chat.activeId); if (th) th.mode = b.dataset.m; }, { type: 'chat' });
      if (b.dataset.m === 'interview' && !activeThread().messages.length) send(INTERVIEW_KICKOFF, { silent: true });
      renderModes();
    });
    $('[data-del-thread]', modesEl).onclick = () => {
      update((s) => {
        s.chat.threads = s.chat.threads.filter((x) => x.id !== s.chat.activeId);
        s.chat.activeId = s.chat.threads[0]?.id || null;
      }, { type: 'chat' });
      if (!threads().length) newThread();
      renderAll();
    };
  }

  function renderChips() {
    const t = activeThread();
    if (t?.messages.length) { chipsEl.innerHTML = ''; return; }
    const prompts = t?.mode === 'resume' ? ['Review my resume and score it', 'Rewrite my summary to be sharper', 'Which bullets are weakest?']
      : t?.mode === 'interview' ? [INTERVIEW_KICKOFF, 'Ask me 5 rapid-fire HR questions', 'Grill me on system design basics']
      : getPrompts();
    chipsEl.innerHTML = prompts.map((p) => `<button class="chip">${esc(p.length > 58 ? p.slice(0, 56) + '…' : p)}</button>`).join('');
    $$('.chip', chipsEl).forEach((c, i) => c.onclick = () => send(prompts[i]));
  }

  function msgHtml(m) {
    return `<div class="msg ${m.role}">
      <div class="msg-avatar">${icon(m.role === 'user' ? 'user' : 'compass', 17)}</div>
      <div class="msg-bubble">${m.role === 'assistant' ? md(m.content) : esc(m.content)}</div>
    </div>`;
  }

  function renderMsgs() {
    const t = activeThread();
    scrollEl.innerHTML = t?.messages.length
      ? t.messages.map(msgHtml).join('')
      : `<div class="empty">${icon('sparkles', 38)}<h3>Ask me anything career-shaped</h3><p>I know your profile${getState().profile.targetRole ? ` and that you're aiming for <b>${esc(getState().profile.targetRole)}</b>` : ''}. Try a suggestion below.</p></div>`;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function renderAll() { renderSide(); renderModes(); renderChips(); renderMsgs(); }

  async function send(text, { silent } = {}) {
    text = String(text ?? inputEl.value).trim();
    if (!text || busy) return;
    inputEl.value = ''; autosize();
    const t = activeThread() || newThread();
    busy = true;
    update((s) => {
      const th = s.chat.threads.find((x) => x.id === t.id);
      if (!silent) th.messages.push({ role: 'user', content: text });
      if (th.title === 'New conversation') th.title = text.slice(0, 42);
    }, { type: 'chat' });
    logActivity(t.mode === 'interview' ? 'mock_interview' : 'chat_message');
    renderSide(); renderChips(); renderMsgs();

    // streaming placeholder
    const holder = el(`<div class="msg assistant"><div class="msg-avatar">${icon('compass', 17)}</div><div class="msg-bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
    scrollEl.appendChild(holder);
    scrollEl.scrollTop = scrollEl.scrollHeight;
    const bubble = $('.msg-bubble', holder);

    const sys = { role: 'system', content: systemPrompt(t.mode) + (t.mode === 'resume' ? `\n\nUSER RESUME:\n${resumePlainText()}` : '') };
    const history = activeThread().messages.map(({ role, content }) => ({ role, content }));
    if (silent) history.push({ role: 'user', content: text });

    let acc = '';
    abort = new AbortController();
    try {
      const full = await llmChat([sys, ...history], {
        signal: abort.signal,
        onDelta: (d) => {
          acc += d;
          bubble.innerHTML = md(acc);
          const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 140;
          if (nearBottom) scrollEl.scrollTop = scrollEl.scrollHeight;
        },
      });
      update((s) => {
        const th = s.chat.threads.find((x) => x.id === t.id);
        th.messages.push({ role: 'assistant', content: full || acc });
      }, { type: 'chat' });
    } catch (e) {
      console.warn('chat error', e);
      bubble.innerHTML = `<p>⚠️ I couldn't reach the free AI service (${esc(e.message)}). It may be rate-limited — wait a few seconds and try again, or set a custom provider in <a href="#/settings">Settings</a>.</p>`;
    } finally {
      busy = false; abort = null;
      renderSide();
    }
  }

  function autosize() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(130, inputEl.scrollHeight) + 'px'; }
  inputEl.addEventListener('input', autosize);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('[data-send]', root).onclick = () => send();
  $('[data-new]', root).onclick = () => { newThread(); renderAll(); };

  renderAll();
  if (activeThread()?.pending) { const p = activeThread().pending; delete activeThread().pending; send(p, { silent: true }); }
  return root;
}
