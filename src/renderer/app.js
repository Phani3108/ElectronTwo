/**
 * Renderer — glue between UI and modules.
 * All cross-module comms via bus; DOM logic stays in this file only.
 */

import { EventBus } from '../bus/event-bus.js';
import { AudioPipeline, STATES } from '../audio/pipeline.js';
import { DeepgramTransport } from '../stt/deepgram-transport.js';
import { ProfileManager } from '../profile/profile-manager.js';
import { StoryRAG } from '../rag/story-rag.js';
import { LLMOrchestrator } from '../llm/orchestrator.js';
import { AutoDrafter } from '../intent/auto-draft.js';
import { LiveNotes } from '../notes/notes.js';
import { SessionManager } from '../session/session-manager.js';

const bus = new EventBus();
const api = window.api;

// ── modules ──
const profiles = new ProfileManager({ bus, api });
const rag = new StoryRAG({ bus, api });
const notes = new LiveNotes({ bus });
const orchestrator = new LLMOrchestrator({ bus, api, rag, profileManager: profiles, notes });
const drafter = new AutoDrafter({ bus, orchestrator });
const session = new SessionManager({ bus, api, notes });
const transport = new DeepgramTransport({
  getApiKey: () => api.getEnv('DEEPGRAM_API_KEY'),
});
const pipeline = new AudioPipeline({ bus, transport });

// ── dom refs ──
const el = {
  healthRow: document.getElementById('health-row'),
  stateLabel: document.getElementById('state-label'),
  profileLabel: document.getElementById('profile-label'),
  modeChip: document.getElementById('mode-chip'),
  timings: document.getElementById('timings'),
  btnNotes: document.getElementById('btn-notes'),
  btnSettings: document.getElementById('btn-settings'),
  start: document.getElementById('btn-start'),
  stop: document.getElementById('btn-stop'),
  transcript: document.getElementById('transcript'),
  intentStrip: document.getElementById('intent-strip'),
  answer: document.getElementById('answer'),
  notesPanel: document.getElementById('notes-panel'),
  notesList: document.getElementById('notes-list'),
  notesInput: document.getElementById('notes-input'),
  btnNotesAdd: document.getElementById('btn-notes-add'),
  askInput: document.getElementById('ask-input'),
  btnAsk: document.getElementById('btn-ask'),
  log: document.getElementById('log'),
  // settings modal
  settingsBackdrop: document.getElementById('settings-backdrop'),
  btnSettingsTest: document.getElementById('btn-settings-test'),
  btnSettingsSave: document.getElementById('btn-settings-save'),
  keyAnthropic: document.getElementById('key-anthropic'),
  keyOpenai: document.getElementById('key-openai'),
  keyDeepgram: document.getElementById('key-deepgram'),
  statusAnthropic: document.getElementById('status-anthropic'),
  statusOpenai: document.getElementById('status-openai'),
  statusDeepgram: document.getElementById('status-deepgram'),
  statusMic: document.getElementById('status-mic'),
};

// ── state ──
let finalText = '';
let interimText = '';
let answerText = '';
let lastTtft = null;
let lastTotal = null;
let lastRetrieved = [];

// ── helpers ──
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function renderTranscript() {
  el.transcript.innerHTML = escapeHtml(finalText) +
    (interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : '');
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function renderAnswer() {
  if (!answerText) { el.answer.innerHTML = `<span style="color:var(--muted)">…waiting…</span>`; return; }
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

function renderHealthDot(svc, state) {
  const dot = el.healthRow.querySelector(`[data-svc="${svc}"]`);
  if (!dot) return;
  let cls = '';
  if (state === 'ok' || state === 'granted') cls = 'ok';
  else if (state === 'missing' || state === 'denied') cls = 'err';
  else if (state && state !== 'unknown') cls = state.startsWith('err') ? 'err' : 'warn';
  dot.className = 'dot' + (cls ? ' ' + cls : '');
  dot.title = `${svc}: ${state}`;
}

function renderIntent({ confidence, urgency, reasons, isQuestion }) {
  const pct = Math.round((confidence || 0) * 100);
  const cls = urgency === 'high' ? 'high' : urgency === 'medium' ? 'med' : '';
  el.intentStrip.innerHTML = `
    <span class="pill ${cls}">intent ${pct}%</span>
    <span>${isQuestion ? 'question' : '—'}</span>
    <span style="opacity:.6">${escapeHtml((reasons || []).join(' · '))}</span>
  `;
}

function renderNotes(list) {
  if (!list.length) {
    el.notesList.innerHTML = `<span style="color:var(--muted)">No notes yet. Add "role: X" for tagged notes or free text.</span>`;
    return;
  }
  el.notesList.innerHTML = list.map(n => `
    <div class="note" data-id="${n.id}">
      <div style="flex:1">${n.tag ? `<span class="tag">${escapeHtml(n.tag)}:</span> ${escapeHtml(n.value)}` : escapeHtml(n.text)}</div>
      <span class="rm" data-id="${n.id}">✕</span>
    </div>
  `).join('');
}

function log(html, cls = '') {
  const row = document.createElement('div');
  row.innerHTML = cls ? `<span class="${cls}">${html}</span>` : html;
  el.log.appendChild(row);
  el.log.scrollTop = el.log.scrollHeight;
  while (el.log.children.length > 120) el.log.removeChild(el.log.firstChild);
}

function healthForAudio(state) {
  if (state === STATES.STREAMING) return 'ok';
  if (state === STATES.ERROR) return 'err';
  if (state === STATES.IDLE || state === STATES.STOPPED) return '';
  return 'warn';
}

// ── bus subscriptions ──
bus.on('audio:state', ({ from, to, reason }) => {
  el.stateLabel.textContent = to.replace(/_/g, ' ').toLowerCase();
  const cls = healthForAudio(to);
  // Use the mic dot to reflect pipeline state (it's the audio health signal)
  renderHealthDot('mic', cls || (to === STATES.STREAMING ? 'ok' : ''));
  log(`<span class="evt">state</span> ${from} → ${to}${reason ? ` <span style="opacity:.6">(${reason})</span>` : ''}`);
});

bus.on('audio:transcript', (t) => {
  if (t.is_final) { finalText += t.text + ' '; interimText = ''; }
  else interimText = t.text;
  renderTranscript();
});

bus.on('audio:error', ({ kind, message, fatal }) => {
  log(`${fatal ? '<b>FATAL</b> ' : ''}${kind}: ${escapeHtml(message)}`, 'err');
});

bus.on('audio:timing', ({ label, ms }) => { if (ms > 0) log(`timing ${label}: ${Math.round(ms)}ms`); });

bus.on('profile:changed', ({ name, profile }) => {
  el.profileLabel.textContent = `profile: ${name} · ${profile.stories.length} stories`;
  log(`<span class="ok">profile</span> → ${name}`);
  answerText = ''; lastRetrieved = [];
  renderAnswer();
  rag.indexProfile(profile).catch(err => log(`rag index failed: ${err.message}`, 'err'));
});

bus.on('rag:indexed', ({ profile, count, ms, embedded }) => {
  log(`<span class="ok">rag</span> ${profile}: ${count} stories (${embedded} embedded) in ${Math.round(ms)}ms`);
});

bus.on('rag:error', ({ message }) => log(`rag error: ${escapeHtml(message)}`, 'err'));

bus.on('intent:classified', (x) => renderIntent(x));
bus.on('intent:draft-queued', ({ in_ms }) => log(`<span class="evt">intent</span> draft queued in ${in_ms}ms`));
bus.on('intent:draft-cancelled', ({ reason }) => log(`intent cancel: ${reason}`));
bus.on('intent:draft-firing', ({ source }) => log(`<span class="ok">intent</span> firing (${source})`));
bus.on('intent:mode', ({ enabled }) => {
  el.modeChip.classList.toggle('on', enabled);
  el.modeChip.textContent = enabled ? 'auto' : 'manual';
});

bus.on('llm:start', ({ question }) => {
  answerText = ''; lastTtft = null; lastTotal = null; lastRetrieved = [];
  renderTimings(); renderAnswer();
  log(`<span class="evt">ask</span> ${escapeHtml(question.substring(0, 80))}${question.length > 80 ? '…' : ''}`);
});

bus.on('llm:retrieved', ({ ids }) => {
  lastRetrieved = ids;
  log(`retrieved: ${ids.map(i => i.id).join(', ') || '(none)'}`);
});

bus.on('llm:ttft', ({ ms }) => {
  lastTtft = ms; renderTimings();
  log(`<span class="ok">ttft</span> ${Math.round(ms)}ms`);
});

bus.on('llm:token', ({ delta }) => { answerText += delta; renderAnswer(); });

bus.on('llm:done', ({ totalMs, usage }) => {
  lastTotal = totalMs; renderTimings();
  const u = usage ? ` · in ${usage.input_tokens || '?'} · cache ${usage.cache_read_input_tokens || 0}/${usage.cache_creation_input_tokens || 0} · out ${usage.output_tokens || '?'}` : '';
  log(`<span class="ok">done</span> ${Math.round(totalMs)}ms${u}`);
});

bus.on('llm:aborted', ({ reason }) => log(`aborted: ${reason}`));
bus.on('llm:error', ({ kind, message }) => log(`llm ${kind}: ${escapeHtml(message)}`, 'err'));

bus.on('notes:changed', ({ notes }) => renderNotes(notes));

bus.on('session:resumed', ({ id, history, notes: n }) => {
  log(`<span class="ok">session</span> resumed ${id} · ${history.length} Q&A · ${n.length} notes`);
});

// ── button / input handlers ──
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

el.modeChip.addEventListener('click', () => drafter.setEnabled(!drafter.enabled));

// Notes
el.btnNotes.addEventListener('click', () => el.notesPanel.classList.toggle('open'));
function submitNote() {
  const t = el.notesInput.value.trim();
  if (!t) return;
  notes.add(t);
  el.notesInput.value = '';
}
el.btnNotesAdd.addEventListener('click', submitNote);
el.notesInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitNote(); });
el.notesList.addEventListener('click', (e) => {
  const rm = e.target.closest('.rm');
  if (rm) notes.remove(rm.dataset.id);
});

// Settings modal
el.btnSettings.addEventListener('click', openSettings);
el.btnSettingsSave.addEventListener('click', saveSettings);
el.btnSettingsTest.addEventListener('click', probeAndRender);
el.settingsBackdrop.addEventListener('click', (e) => {
  if (e.target === el.settingsBackdrop) el.settingsBackdrop.classList.remove('open');
});

async function openSettings() {
  const all = await api.configGetAll();
  el.keyAnthropic.value = '';
  el.keyOpenai.value = '';
  el.keyDeepgram.value = '';
  el.keyAnthropic.placeholder = all.ANTHROPIC_API_KEY || 'sk-ant-…';
  el.keyOpenai.placeholder = all.OPENAI_API_KEY || 'sk-…';
  el.keyDeepgram.placeholder = all.DEEPGRAM_API_KEY || 'token…';
  el.settingsBackdrop.classList.add('open');
  probeAndRender();
}

async function saveSettings() {
  const updates = [];
  if (el.keyAnthropic.value) updates.push(api.configSet('ANTHROPIC_API_KEY', el.keyAnthropic.value));
  if (el.keyOpenai.value) updates.push(api.configSet('OPENAI_API_KEY', el.keyOpenai.value));
  if (el.keyDeepgram.value) updates.push(api.configSet('DEEPGRAM_API_KEY', el.keyDeepgram.value));
  await Promise.all(updates);
  await probeAndRender();
  el.settingsBackdrop.classList.remove('open');
  log(`<span class="ok">settings</span> saved`);
}

async function probeAndRender() {
  const r = await api.probeServices();
  renderHealthDot('mic', r.mic);
  renderHealthDot('anthropic', r.anthropic);
  renderHealthDot('openai', r.openai);
  renderHealthDot('deepgram', r.deepgram);
  el.statusMic.textContent = r.mic;
  el.statusMic.className = 'status ' + (r.mic === 'granted' || r.mic === 'ok' ? 'ok' : r.mic === 'denied' ? 'err' : 'warn');
  const set = (elStatus, v) => {
    elStatus.textContent = v;
    elStatus.className = 'status ' + (v === 'ok' ? 'ok' : v === 'missing' ? 'missing' : v.startsWith('err') ? 'err' : 'warn');
  };
  set(el.statusAnthropic, r.anthropic);
  set(el.statusOpenai, r.openai);
  set(el.statusDeepgram, r.deepgram);
}

// Spacebar override (force-draft or cancel in-flight) — only outside inputs
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  drafter.forceDraftOrCancel();
});

// Open settings with Cmd+,
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
});

window.addEventListener('beforeunload', () => pipeline.dispose());

// ── boot ──
(async () => {
  try {
    // Phase 2 acceptance: pre-flight health in <2s with visible status
    const t0 = performance.now();
    const probePromise = probeAndRender();
    await profiles.initialize();
    await session.tryResume();
    await probePromise;
    const ms = performance.now() - t0;
    log(`<span class="ok">boot</span> ready in ${Math.round(ms)}ms`);
  } catch (err) {
    log(`boot failed: ${escapeHtml(err.message)}`, 'err');
  }
})();
