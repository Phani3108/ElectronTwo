/**
 * Renderer — thin glue between UI and orchestrator.
 *
 * Wiring:
 *   ProfileManager  → RAG ← bus
 *   AudioPipeline   → bus (transcripts will feed orchestrator later)
 *   LLMOrchestrator → bus (tokens, ttft, done)
 *   UI              ← bus (everything renders from events)
 */

import { EventBus } from '../bus/event-bus.js';
import { AudioPipeline, STATES } from '../audio/pipeline.js';
import { DeepgramTransport } from '../stt/deepgram-transport.js';
import { ProfileManager } from '../profile/profile-manager.js';
import { StoryRAG } from '../rag/story-rag.js';
import { LLMOrchestrator } from '../llm/orchestrator.js';

const bus = new EventBus();
const api = window.api;

const profiles = new ProfileManager({ bus, api });
const rag = new StoryRAG({ bus, api });
const orchestrator = new LLMOrchestrator({ bus, api, rag, profileManager: profiles });

const transport = new DeepgramTransport({
  getApiKey: () => api.getEnv('DEEPGRAM_API_KEY'),
});
const pipeline = new AudioPipeline({ bus, transport });

// ─── UI refs ────────────────────────────────────────────────────────────
const el = {
  dot: document.getElementById('health-dot'),
  stateLabel: document.getElementById('state-label'),
  profileLabel: document.getElementById('profile-label'),
  timings: document.getElementById('timings'),
  start: document.getElementById('btn-start'),
  stop: document.getElementById('btn-stop'),
  transcript: document.getElementById('transcript'),
  answer: document.getElementById('answer'),
  askInput: document.getElementById('ask-input'),
  btnAsk: document.getElementById('btn-ask'),
  log: document.getElementById('log'),
};

let finalText = '';
let interimText = '';
let answerText = '';
let lastTtft = null;
let lastTotal = null;
let lastRetrieved = [];

// ─── helpers ────────────────────────────────────────────────────────────
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function renderTranscript() {
  el.transcript.innerHTML = escapeHtml(finalText) +
    (interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : '');
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function renderAnswer() {
  if (!answerText) {
    el.answer.innerHTML = `<span style="color:var(--muted)">…waiting…</span>`;
    return;
  }
  const meta = lastRetrieved.length
    ? `<div class="meta">sources: ${lastRetrieved.map(r => `${escapeHtml(r.id)} · ${r.score.toFixed(2)}`).join(' · ')}</div>`
    : '';
  el.answer.innerHTML = escapeHtml(answerText) + meta;
  el.answer.scrollTop = el.answer.scrollHeight;
}

function renderTimings() {
  const parts = [];
  if (lastTtft != null) parts.push(`ttft ${Math.round(lastTtft)}ms`);
  if (lastTotal != null) parts.push(`total ${Math.round(lastTotal)}ms`);
  el.timings.textContent = parts.join(' · ');
}

function log(html, cls = '') {
  const row = document.createElement('div');
  row.innerHTML = cls ? `<span class="${cls}">${html}</span>` : html;
  el.log.appendChild(row);
  el.log.scrollTop = el.log.scrollHeight;
  while (el.log.children.length > 120) el.log.removeChild(el.log.firstChild);
}

function healthFor(state) {
  if (state === STATES.STREAMING) return 'ok';
  if (state === STATES.ERROR) return 'err';
  if (state === STATES.IDLE || state === STATES.STOPPED) return '';
  return 'warn';
}

// ─── bus subscriptions ──────────────────────────────────────────────────
bus.on('audio:state', ({ from, to, reason }) => {
  el.stateLabel.textContent = to.replace(/_/g, ' ').toLowerCase();
  el.dot.className = 'dot ' + healthFor(to);
  log(`<span class="evt">state</span> ${from} → ${to}${reason ? ` <span style="opacity:.6">(${reason})</span>` : ''}`);
});

bus.on('audio:transcript', (t) => {
  if (t.is_final) {
    finalText += t.text + ' ';
    interimText = '';
  } else {
    interimText = t.text;
  }
  renderTranscript();
});

bus.on('audio:error', ({ kind, message, fatal }) => {
  log(`${fatal ? '<b>FATAL</b> ' : ''}${kind}: ${escapeHtml(message)}`, 'err');
});

bus.on('audio:timing', ({ label, ms }) => {
  if (ms > 0) log(`timing ${label}: ${Math.round(ms)}ms`);
});

bus.on('profile:changed', ({ name, profile }) => {
  el.profileLabel.textContent = `profile: ${name} · ${profile.stories.length} stories`;
  log(`<span class="ok">profile</span> → ${name}`);
  answerText = '';
  lastRetrieved = [];
  renderAnswer();
  // Re-index RAG for the new profile.
  rag.indexProfile(profile).catch(err => log(`rag index failed: ${err.message}`, 'err'));
});

bus.on('rag:indexed', ({ profile, count, ms, embedded }) => {
  log(`<span class="ok">rag</span> ${profile}: ${count} stories (${embedded} embedded) in ${Math.round(ms)}ms`);
});

bus.on('rag:error', ({ message }) => {
  log(`rag error: ${escapeHtml(message)}`, 'err');
});

bus.on('llm:start', ({ question }) => {
  answerText = '';
  lastTtft = null;
  lastTotal = null;
  lastRetrieved = [];
  renderTimings();
  renderAnswer();
  log(`<span class="evt">ask</span> ${escapeHtml(question.substring(0, 80))}${question.length > 80 ? '…' : ''}`);
});

bus.on('llm:retrieved', ({ ids }) => {
  lastRetrieved = ids;
  log(`retrieved: ${ids.map(i => i.id).join(', ') || '(none)'}`);
});

bus.on('llm:ttft', ({ ms }) => {
  lastTtft = ms;
  renderTimings();
  log(`<span class="ok">ttft</span> ${Math.round(ms)}ms`);
});

bus.on('llm:token', ({ delta }) => {
  answerText += delta;
  renderAnswer();
});

bus.on('llm:done', ({ totalMs, usage }) => {
  lastTotal = totalMs;
  renderTimings();
  const u = usage ? ` · in ${usage.input_tokens || '?'} · cache ${usage.cache_read_input_tokens || 0}/${usage.cache_creation_input_tokens || 0} · out ${usage.output_tokens || '?'}` : '';
  log(`<span class="ok">done</span> ${Math.round(totalMs)}ms${u}`);
});

bus.on('llm:aborted', ({ reason }) => log(`aborted: ${reason}`));
bus.on('llm:error', ({ kind, message }) => log(`llm ${kind}: ${escapeHtml(message)}`, 'err'));

// ─── button / input handlers ────────────────────────────────────────────
el.start.addEventListener('click', () => pipeline.start().catch(err => log(`start threw: ${err.message}`, 'err')));
el.stop.addEventListener('click', () => pipeline.stop());

function submitQuestion() {
  const q = el.askInput.value.trim();
  if (!q) return;
  el.askInput.value = '';
  orchestrator.ask(q);
}
el.btnAsk.addEventListener('click', submitQuestion);
el.askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitQuestion(); });

el.profileLabel.addEventListener('click', () => {
  profiles.cycle().catch(err => log(`cycle failed: ${err.message}`, 'err'));
});

api.onProfileCycle(() => {
  profiles.cycle().catch(err => log(`cycle failed: ${err.message}`, 'err'));
});

window.addEventListener('beforeunload', () => pipeline.dispose());

// ─── boot ──────────────────────────────────────────────────────────────
(async () => {
  try {
    await profiles.initialize();
    log(`<span class="ok">boot</span> ready`);
  } catch (err) {
    log(`boot failed: ${escapeHtml(err.message)}`, 'err');
  }
})();
