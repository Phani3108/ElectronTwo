/**
 * Renderer — glue between UI and modules.
 * All cross-module comms via bus; DOM logic stays in this file only.
 */

import { EventBus } from '../bus/event-bus.js';
import { AudioPipeline, STATES } from '../audio/pipeline.js';
import { DeepgramTransport } from '../stt/deepgram-transport.js';
import { WhisperTransport } from '../stt/whisper-transport.js';
import { FallbackTransport } from '../stt/fallback-transport.js';
import { ProfileManager } from '../profile/profile-manager.js';
import { StoryRAG } from '../rag/story-rag.js';
import { LLMOrchestrator } from '../llm/orchestrator.js';
import { AnthropicProvider } from '../llm/providers/anthropic.js';
import { OllamaProvider } from '../llm/providers/ollama.js';
import { AzureOpenAIProvider } from '../llm/providers/azure-openai.js';
import { AutoDrafter } from '../intent/auto-draft.js';
import { LiveNotes } from '../notes/notes.js';
import { SessionManager } from '../session/session-manager.js';
import { Metrics } from '../observability/metrics.js';

const bus = new EventBus();
const api = window.api;

// ── modules ──
const profiles = new ProfileManager({ bus, api });
const rag = new StoryRAG({ bus, api });
const notes = new LiveNotes({ bus });
const metrics = new Metrics({ bus });

const anthropic = new AnthropicProvider({ getApiKey: () => api.getEnv('ANTHROPIC_API_KEY') });
const ollama = new OllamaProvider();
const azure = new AzureOpenAIProvider({
  getConfig: async () => {
    const all = await api.configGetAll();
    // configGetAll redacts keys (returns "set:xxxx…yyyy" marker). For the
    // actual value we read via getEnv which fetches the raw stored key.
    const sensitiveKeys = ['AZURE_OPENAI_API_KEY'];
    const cfg = { ...all };
    for (const k of sensitiveKeys) {
      if (typeof cfg[k] === 'string' && cfg[k].startsWith('set:')) {
        cfg[k] = await api.getEnv(k);
      } else if (!cfg[k]) {
        cfg[k] = await api.getEnv(k);
      }
    }
    return cfg;
  },
});

const orchestrator = new LLMOrchestrator({
  bus, rag, profileManager: profiles, notes,
  providers: [anthropic, azure, ollama], // default order; rewired after config load
});

const drafter = new AutoDrafter({ bus, orchestrator });
const session = new SessionManager({ bus, api, notes });

const deepgram = new DeepgramTransport({ getApiKey: () => api.getEnv('DEEPGRAM_API_KEY') });
const whisper = new WhisperTransport();
const sttTransport = new FallbackTransport({
  transports: [deepgram, whisper],
  names: ['deepgram', 'whisper-local'],
  bus,
});
const pipeline = new AudioPipeline({ bus, transport: sttTransport });

// ── dom refs ──
const el = {
  healthRow: document.getElementById('health-row'),
  stateLabel: document.getElementById('state-label'),
  profileLabel: document.getElementById('profile-label'),
  modeChip: document.getElementById('mode-chip'),
  offlineChip: document.getElementById('offline-chip'),
  metricsStrip: document.getElementById('metrics-strip'),
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
  btnProfileExport: document.getElementById('btn-profile-export'),
  btnProfileImport: document.getElementById('btn-profile-import'),
  selLlmProvider: document.getElementById('sel-llm-provider'),
  selEmbeddingProvider: document.getElementById('sel-embedding-provider'),
  // keys
  keyAnthropic: document.getElementById('key-anthropic'),
  keyOpenai: document.getElementById('key-openai'),
  keyDeepgram: document.getElementById('key-deepgram'),
  keyAzure: document.getElementById('key-azure'),
  keyAzureResource: document.getElementById('key-azure-resource'),
  keyAzureChatDeployment: document.getElementById('key-azure-chat-deployment'),
  keyAzureEmbeddingDeployment: document.getElementById('key-azure-embedding-deployment'),
  keyAzureVersion: document.getElementById('key-azure-version'),
  btnSaveAzure: document.getElementById('btn-save-azure'),
  btnTestAzureChat: document.getElementById('btn-test-azure-chat'),
  btnTestAzureEmbedding: document.getElementById('btn-test-azure-embedding'),
  // rows (to show/hide by provider)
  rowAnthropic: document.getElementById('row-anthropic'),
  rowAzureKey: document.getElementById('row-azure-key'),
  rowAzureResource: document.getElementById('row-azure-resource'),
  rowAzureChat: document.getElementById('row-azure-chat'),
  rowAzureEmbedding: document.getElementById('row-azure-embedding'),
  rowAzureVersion: document.getElementById('row-azure-version'),
  rowOpenai: document.getElementById('row-openai'),
  rowDeepgram: document.getElementById('row-deepgram'),
  statusAnthropic: document.getElementById('status-anthropic'),
  statusOpenai: document.getElementById('status-openai'),
  statusDeepgram: document.getElementById('status-deepgram'),
  statusAzure: document.getElementById('status-azure'),
  statusMic: document.getElementById('status-mic'),
  // sessions panel
  btnSessions: document.getElementById('btn-sessions'),
  sessionsBackdrop: document.getElementById('sessions-backdrop'),
  sessionsList: document.getElementById('sessions-list'),
  sessionDetail: document.getElementById('session-detail'),
  btnSessionImport: document.getElementById('btn-session-import'),
  btnSessionsClose: document.getElementById('btn-sessions-close'),
  // stories panel (profile contents browser)
  btnStories: document.getElementById('btn-stories'),
  storiesBackdrop: document.getElementById('stories-backdrop'),
  storiesList: document.getElementById('stories-list'),
  storiesSearch: document.getElementById('stories-search'),
  storiesCount: document.getElementById('stories-count'),
  btnStoriesClose: document.getElementById('btn-stories-close'),
  // onboarding
  onboardBackdrop: document.getElementById('onboarding-backdrop'),
  onboardStep1: document.getElementById('onboarding-step-1'),
  onboardStep2: document.getElementById('onboarding-step-2'),
  onboardStep3: document.getElementById('onboarding-step-3'),
  onboardIndicator1: document.getElementById('step-indicator-1'),
  onboardIndicator2: document.getElementById('step-indicator-2'),
  onboardIndicator3: document.getElementById('step-indicator-3'),
  onboardMicStatus: document.getElementById('onboard-mic-status'),
  onboardStatusAnthropic: document.getElementById('onboard-status-anthropic'),
  onboardStatusOpenai: document.getElementById('onboard-status-openai'),
  onboardStatusDeepgram: document.getElementById('onboard-status-deepgram'),
  onboardKeyAnthropic: document.getElementById('onboard-key-anthropic'),
  onboardKeyOpenai: document.getElementById('onboard-key-openai'),
  onboardKeyDeepgram: document.getElementById('onboard-key-deepgram'),
  btnOnboardSkip: document.getElementById('btn-onboard-skip'),
  btnOnboardNext1: document.getElementById('btn-onboard-next-1'),
  btnOnboardBack2: document.getElementById('btn-onboard-back-2'),
  btnOnboardTest2: document.getElementById('btn-onboard-test-2'),
  btnOnboardNext2: document.getElementById('btn-onboard-next-2'),
  btnOnboardBack3: document.getElementById('btn-onboard-back-3'),
  btnOnboardFinish: document.getElementById('btn-onboard-finish'),
  btnOnboardImportProfile: document.getElementById('btn-onboard-import-profile'),
  btnOnboardOpenProfileDir: document.getElementById('btn-onboard-open-profile-dir'),
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

bus.on('metrics:update', (snap) => {
  const last = snap.last || {};
  const p50 = snap.p50 || {};
  const parts = [];
  if (last.stt_connect != null) parts.push(`stt ${Math.round(last.stt_connect)}`);
  if (last.rag != null) parts.push(`rag ${Math.round(last.rag)}`);
  if (last.ttft != null) parts.push(`ttft ${Math.round(last.ttft)}`);
  if (last.total != null) parts.push(`total ${Math.round(last.total)}`);
  const p50parts = [];
  if (p50.ttft != null) p50parts.push(`p50 ttft ${Math.round(p50.ttft)}`);
  if (p50.total != null) p50parts.push(`total ${Math.round(p50.total)}`);
  el.metricsStrip.innerHTML = parts.length
    ? `<span class="pill">${parts.join(' · ')}</span>${p50parts.length ? `<span style="opacity:.6">${p50parts.join(' · ')}</span>` : ''}`
    : '';
});

bus.on('stt:transport-selected', ({ name, fallback }) => {
  log(`<span class="${fallback ? 'evt' : 'ok'}">stt</span> → ${name}${fallback ? ' (fallback)' : ''}`);
});
bus.on('stt:transport-failed', ({ name, reason }) => {
  log(`stt ${name} failed: ${escapeHtml(reason)}`, 'err');
});
bus.on('llm:provider', ({ name, fallback }) => {
  if (fallback) log(`<span class="evt">llm</span> fallback → ${name}`);
});

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

let offline = false;
el.offlineChip.addEventListener('click', () => {
  offline = !offline;
  el.offlineChip.classList.toggle('on', offline);
  el.offlineChip.textContent = offline ? 'offline' : 'online';
  orchestrator.setProviderOrder(offline ? ['ollama', 'anthropic'] : ['anthropic', 'ollama']);
  log(`<span class="evt">mode</span> ${offline ? 'offline (ollama primary)' : 'online (anthropic primary)'}`);
});

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

// ─── settings modal ───────────────────────────────────────────────────
function setStatus(elStatus, state, detail) {
  if (!elStatus) return;
  elStatus.textContent = state + (detail ? ` (${detail.substring(0, 40)})` : '');
  let cls = '';
  if (state === 'ok' || state === 'granted') cls = 'ok';
  else if (state === 'missing' || state === 'denied') cls = 'err';
  else if (typeof state === 'string' && state.startsWith('err')) cls = 'err';
  else if (state) cls = 'warn';
  elStatus.className = 'status ' + cls;
}

el.btnSettings.addEventListener('click', openSettings);
el.btnSettingsSave.addEventListener('click', () => el.settingsBackdrop.classList.remove('open'));
el.btnSettingsTest.addEventListener('click', probeAndRender);
el.settingsBackdrop.addEventListener('click', (e) => {
  if (e.target === el.settingsBackdrop) el.settingsBackdrop.classList.remove('open');
});

// LLM provider picker — saves to config and rewires orchestrator.
el.selLlmProvider.addEventListener('change', async () => {
  const v = el.selLlmProvider.value;
  await api.configSet('llm_provider', v);
  applyLlmProvider(v);
  refreshSettingsVisibility();
});
el.selEmbeddingProvider.addEventListener('change', async () => {
  await api.configSet('embedding_provider', el.selEmbeddingProvider.value);
  refreshSettingsVisibility();
});

function applyLlmProvider(v) {
  if (v === 'azure') orchestrator.setProviderOrder(['azure', 'anthropic', 'ollama']);
  else if (v === 'ollama') orchestrator.setProviderOrder(['ollama', 'anthropic', 'azure']);
  else orchestrator.setProviderOrder(['anthropic', 'azure', 'ollama']);
  log(`<span class="evt">llm</span> primary → ${v}`);
}

function refreshSettingsVisibility() {
  const p = el.selLlmProvider.value;
  el.rowAnthropic.style.display = (p === 'anthropic') ? '' : 'none';
  const showAzure = (p === 'azure') || (el.selEmbeddingProvider.value === 'azure');
  el.rowAzureKey.style.display = showAzure ? '' : 'none';
  el.rowAzureResource.style.display = showAzure ? '' : 'none';
  el.rowAzureChat.style.display = (p === 'azure') ? '' : 'none';
  el.rowAzureEmbedding.style.display = (el.selEmbeddingProvider.value === 'azure') ? '' : 'none';
  el.rowAzureVersion.style.display = showAzure ? '' : 'none';
  // OpenAI only needed if embeddings go to OpenAI.
  el.rowOpenai.style.display = (el.selEmbeddingProvider.value === 'openai') ? '' : 'none';
}

// Per-key [Save] buttons (wired generically via data-save-key)
document.querySelectorAll('[data-save-key]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const configKey = btn.dataset.saveKey;
    const inputId = btn.dataset.input;
    const input = document.getElementById(inputId);
    if (!input) return;
    const value = input.value.trim();
    if (!value) { log(`${configKey}: empty — nothing saved`); return; }
    await api.configSet(configKey, value);
    input.value = '';
    input.placeholder = 'saved ✓';
    log(`<span class="ok">saved</span> ${configKey}`);
  });
});

// Per-key [Test] buttons (via data-test-provider)
document.querySelectorAll('[data-test-provider]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.testProvider;
    const collect = (btn.dataset.collectInputs || '').split(',').filter(Boolean);
    const overrides = {};
    for (const pair of collect) {
      const [cfgKey, inputId] = pair.split(':');
      const input = document.getElementById(inputId);
      if (input && input.value.trim()) overrides[cfgKey] = input.value.trim();
    }
    btn.disabled = true;
    btn.textContent = 'Testing…';
    const r = await api.keyTest(provider, overrides);
    btn.disabled = false;
    btn.textContent = 'Test';
    const statusEl = {
      anthropic: el.statusAnthropic,
      openai: el.statusOpenai,
      deepgram: el.statusDeepgram,
    }[provider];
    if (statusEl) setStatus(statusEl, r.ok ? 'ok' : (r.reason || 'err'));
    log(r.ok ? `<span class="ok">${provider} test ok</span>` : `${provider} test failed: ${escapeHtml(r.reason || 'err')}${r.detail ? ` — ${escapeHtml(r.detail)}` : ''}`, r.ok ? '' : 'err');
  });
});

// Azure: Save + Test chat + Test embedding
el.btnSaveAzure.addEventListener('click', async () => {
  const writes = [];
  const pairs = [
    ['AZURE_OPENAI_API_KEY', el.keyAzure],
    ['AZURE_OPENAI_RESOURCE', el.keyAzureResource],
    ['AZURE_OPENAI_CHAT_DEPLOYMENT', el.keyAzureChatDeployment],
    ['AZURE_OPENAI_EMBEDDING_DEPLOYMENT', el.keyAzureEmbeddingDeployment],
    ['AZURE_OPENAI_API_VERSION', el.keyAzureVersion],
  ];
  for (const [cfgKey, input] of pairs) {
    if (input.value.trim()) writes.push(api.configSet(cfgKey, input.value.trim()));
  }
  await Promise.all(writes);
  for (const [, input] of pairs) if (input.value) { input.value = ''; input.placeholder = 'saved ✓'; }
  log(`<span class="ok">saved</span> Azure fields`);
});

async function testAzure(endpoint) {
  const overrides = {
    AZURE_OPENAI_API_KEY: el.keyAzure.value.trim() || undefined,
    AZURE_OPENAI_RESOURCE: el.keyAzureResource.value.trim() || undefined,
    AZURE_OPENAI_CHAT_DEPLOYMENT: el.keyAzureChatDeployment.value.trim() || undefined,
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: el.keyAzureEmbeddingDeployment.value.trim() || undefined,
    AZURE_OPENAI_API_VERSION: el.keyAzureVersion.value.trim() || undefined,
  };
  // Strip undefined so main uses stored value as fallback.
  for (const k of Object.keys(overrides)) if (overrides[k] === undefined) delete overrides[k];
  const r = await api.keyTest(endpoint, overrides);
  setStatus(el.statusAzure, r.ok ? 'ok' : (r.reason || 'err'));
  log(r.ok ? `<span class="ok">azure ${endpoint} ok</span>` : `azure ${endpoint} failed: ${escapeHtml(r.reason || 'err')}${r.detail ? ` — ${escapeHtml(r.detail)}` : ''}`, r.ok ? '' : 'err');
}
el.btnTestAzureChat.addEventListener('click', () => testAzure('azure'));
el.btnTestAzureEmbedding.addEventListener('click', () => testAzure('azure-embedding'));

async function openSettings() {
  const all = await api.configGetAll();
  el.selLlmProvider.value = all.llm_provider || 'anthropic';
  el.selEmbeddingProvider.value = all.embedding_provider || 'openai';
  // Sensitive (API keys): clear input, show masked saved value as placeholder.
  // Non-sensitive (resource, deployments, version): pre-fill input so user sees the saved value.
  [el.keyAnthropic, el.keyOpenai, el.keyDeepgram, el.keyAzure].forEach(i => { i.value = ''; });
  el.keyAnthropic.placeholder = all.ANTHROPIC_API_KEY || 'sk-ant-…';
  el.keyOpenai.placeholder = all.OPENAI_API_KEY || 'sk-…';
  el.keyDeepgram.placeholder = all.DEEPGRAM_API_KEY || 'token…';
  el.keyAzure.placeholder = all.AZURE_OPENAI_API_KEY || 'saved — leave blank to keep';
  el.keyAzureResource.value = all.AZURE_OPENAI_RESOURCE || '';
  el.keyAzureResource.placeholder = 'my-aoai-resource';
  el.keyAzureChatDeployment.value = all.AZURE_OPENAI_CHAT_DEPLOYMENT || '';
  el.keyAzureChatDeployment.placeholder = 'gpt-4o';
  el.keyAzureEmbeddingDeployment.value = all.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || '';
  el.keyAzureEmbeddingDeployment.placeholder = 'text-embedding-3-small';
  el.keyAzureVersion.value = all.AZURE_OPENAI_API_VERSION || '';
  el.keyAzureVersion.placeholder = '2024-08-01-preview';
  refreshSettingsVisibility();
  el.settingsBackdrop.classList.add('open');
  probeAndRender();
}

el.btnProfileExport.addEventListener('click', async () => {
  const name = profiles.active?.name;
  if (!name) { log('no active profile', 'err'); return; }
  const r = await api.profileExport(name);
  if (r?.error) log(`export failed: ${escapeHtml(r.error)}`, 'err');
  else if (r?.cancelled) log('export cancelled');
  else log(`<span class="ok">exported</span> ${name} · ${r.storyCount} stories → ${escapeHtml(r.path)}`);
});
el.btnProfileImport.addEventListener('click', async () => {
  const r = await api.profileImport();
  if (r?.error) { log(`import failed: ${escapeHtml(r.error)}`, 'err'); return; }
  if (r?.cancelled) return;
  log(`<span class="ok">imported</span> ${r.name} · ${r.storyCount} stories`);
  // Re-initialize profile manager and RAG
  await profiles.reload?.() || await profiles.initialize();
});

// Stories (profile contents) panel
el.btnStories.addEventListener('click', openStories);
el.btnStoriesClose.addEventListener('click', () => el.storiesBackdrop.classList.remove('open'));
el.storiesBackdrop.addEventListener('click', (e) => {
  if (e.target === el.storiesBackdrop) el.storiesBackdrop.classList.remove('open');
});
el.storiesSearch.addEventListener('input', () => renderStories(el.storiesSearch.value));

function openStories() {
  el.storiesBackdrop.classList.add('open');
  el.storiesSearch.value = '';
  renderStories('');
}

function renderStories(filterStr) {
  const profile = profiles.active;
  if (!profile) {
    el.storiesList.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center">No active profile.</div>`;
    el.storiesCount.textContent = '';
    return;
  }
  const q = (filterStr || '').toLowerCase().trim();
  const stories = profile.stories.filter(s =>
    !q || s.id.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
  );
  el.storiesCount.textContent = `${stories.length} of ${profile.stories.length} · profile: ${profile.name}`;
  if (stories.length === 0) {
    el.storiesList.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center">No stories match "${escapeHtml(q)}".</div>`;
    return;
  }
  el.storiesList.innerHTML = stories.map(s => {
    const preview = s.content.replace(/\*\*[^*]+\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    return `<details style="border-bottom:1px solid var(--border); padding:8px 4px;">
      <summary style="cursor:pointer; outline:none;">
        <span style="color:var(--accent); font-family:ui-monospace,Menlo,monospace; font-size:11px;">${escapeHtml(s.id)}</span>
        <div style="color:var(--muted); font-size:11px; margin-top:2px; padding-left:0;">${escapeHtml(preview)}…</div>
      </summary>
      <div style="margin-top:8px; padding:8px 10px; background:rgba(255,255,255,0.03); border-radius:6px; white-space:pre-wrap; font-size:12px; line-height:1.55;">${escapeHtml(s.content)}</div>
    </details>`;
  }).join('');
}

bus.on('profile:changed', () => {
  // Refresh stories list if it's open
  if (el.storiesBackdrop.classList.contains('open')) renderStories(el.storiesSearch.value);
});

// Sessions panel
el.btnSessions.addEventListener('click', openSessions);
el.btnSessionsClose.addEventListener('click', () => el.sessionsBackdrop.classList.remove('open'));
el.btnSessionImport.addEventListener('click', async () => {
  const r = await api.sessionImport();
  if (r?.imported?.length) log(`<span class="ok">imported</span> ${r.imported.length} session(s)`);
  renderSessions();
});
el.sessionsBackdrop.addEventListener('click', (e) => {
  if (e.target === el.sessionsBackdrop) el.sessionsBackdrop.classList.remove('open');
});

async function openSessions() {
  el.sessionsBackdrop.classList.add('open');
  renderSessions();
}

async function renderSessions() {
  el.sessionDetail.style.display = 'none';
  el.sessionsList.style.display = 'block';
  const list = await api.sessionList();
  if (!list?.length) {
    el.sessionsList.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center">No sessions yet. Record a desktop session or import one from the phone.</div>`;
    return;
  }
  el.sessionsList.innerHTML = list.map(s => {
    const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
    const badge = s.source === 'android' ? '📱' : '💻';
    return `<div class="session-row" data-file="${escapeHtml(s.file)}" style="padding:8px 6px; border-bottom:1px solid var(--border); cursor:pointer;">
      <div style="display:flex; gap:8px; align-items:center;">
        <span>${badge}</span>
        <span style="flex:1; color:var(--fg);">${escapeHtml(s.profile || '(no profile)')}</span>
        <span style="color:var(--muted); font-size:11px;">${escapeHtml(when)}</span>
      </div>
      <div style="color:var(--muted); font-size:11px; margin-top:2px;">${s.historyCount} Q&A · ${s.notesCount} notes · ${s.transcriptChars} chars transcript</div>
    </div>`;
  }).join('');
  el.sessionsList.querySelectorAll('.session-row').forEach(row => {
    row.addEventListener('click', async () => {
      const file = row.dataset.file;
      const s = await api.sessionRead(file);
      if (!s) return;
      const turns = (s.history || []).map(h => `<div style="margin-bottom:10px;"><div style="color:var(--accent); font-size:11px;">${escapeHtml(h.mode || 'desktop')} · ${escapeHtml(new Date(h.ts || 0).toLocaleTimeString())}</div><div><b>Q:</b> ${escapeHtml(h.q || '')}</div><div><b>A:</b> ${escapeHtml(h.a || '')}</div></div>`).join('');
      const notes = (s.notes || []).map(n => `<div style="color:var(--warn);">- ${escapeHtml(n.text || '')}</div>`).join('');
      el.sessionDetail.innerHTML = `
        <div style="margin-bottom:10px;"><button id="btn-session-back">← back</button></div>
        <div><b>Profile:</b> ${escapeHtml(s.profile || '')}</div>
        <div><b>Source:</b> ${escapeHtml(s.source || 'desktop')}</div>
        <div><b>Saved:</b> ${escapeHtml(s.savedAt ? new Date(s.savedAt).toLocaleString() : '')}</div>
        ${notes ? `<div style="margin-top:10px;"><b>Notes</b></div>${notes}` : ''}
        <div style="margin-top:10px;"><b>Turns</b></div>${turns || '<em style="color:var(--muted);">(no Q&A captured)</em>'}
        <div style="margin-top:10px;"><b>Transcript</b></div><div style="white-space:pre-wrap; color:var(--muted);">${escapeHtml(s.transcript || '')}</div>
      `;
      el.sessionsList.style.display = 'none';
      el.sessionDetail.style.display = 'block';
      document.getElementById('btn-session-back').addEventListener('click', renderSessions);
    });
  });
}

async function probeAndRender() {
  const r = await api.probeServices();
  renderHealthDot('mic', r.mic);
  renderHealthDot('anthropic', r.anthropic);
  renderHealthDot('openai', r.openai);
  renderHealthDot('deepgram', r.deepgram);
  renderHealthDot('ollama', r.ollama);
  renderHealthDot('azure', r.azure);
  if (el.statusMic) {
    el.statusMic.textContent = r.mic;
    el.statusMic.className = 'status ' + (r.mic === 'granted' || r.mic === 'ok' ? 'ok' : r.mic === 'denied' ? 'err' : 'warn');
  }
  setStatus(el.statusAnthropic, r.anthropic);
  setStatus(el.statusOpenai, r.openai);
  setStatus(el.statusDeepgram, r.deepgram);
  setStatus(el.statusAzure, r.azure);
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

// ── onboarding ──
function showOnboardingStep(n) {
  [el.onboardStep1, el.onboardStep2, el.onboardStep3].forEach((s, i) => s.style.display = (i + 1 === n) ? 'block' : 'none');
  el.onboardIndicator1.style.background = n >= 1 ? 'var(--accent)' : 'var(--border)';
  el.onboardIndicator2.style.background = n >= 2 ? 'var(--accent)' : 'var(--border)';
  el.onboardIndicator3.style.background = n >= 3 ? 'var(--accent)' : 'var(--border)';
}

async function updateOnboardStatus() {
  const r = await api.probeServices();
  const setStat = (es, v) => {
    es.textContent = v;
    es.className = 'status ' + (v === 'ok' ? 'ok' : (v === 'missing' ? 'missing' : (typeof v === 'string' && v.startsWith('err') ? 'err' : 'warn')));
  };
  el.onboardMicStatus.textContent = r.mic;
  el.onboardMicStatus.className = 'status ' + (r.mic === 'granted' || r.mic === 'ok' ? 'ok' : r.mic === 'denied' ? 'err' : 'warn');
  setStat(el.onboardStatusAnthropic, r.anthropic);
  setStat(el.onboardStatusOpenai, r.openai);
  setStat(el.onboardStatusDeepgram, r.deepgram);
}

async function saveOnboardingKeys() {
  const writes = [];
  if (el.onboardKeyAnthropic.value) writes.push(api.configSet('ANTHROPIC_API_KEY', el.onboardKeyAnthropic.value));
  if (el.onboardKeyOpenai.value) writes.push(api.configSet('OPENAI_API_KEY', el.onboardKeyOpenai.value));
  if (el.onboardKeyDeepgram.value) writes.push(api.configSet('DEEPGRAM_API_KEY', el.onboardKeyDeepgram.value));
  await Promise.all(writes);
}

async function finishOnboarding() {
  await api.configSet('onboarding_complete', true);
  el.onboardBackdrop.classList.remove('open');
  await probeAndRender();
}

el.btnOnboardSkip.addEventListener('click', finishOnboarding);
el.btnOnboardNext1.addEventListener('click', () => { showOnboardingStep(2); updateOnboardStatus(); });
el.btnOnboardBack2.addEventListener('click', () => showOnboardingStep(1));
el.btnOnboardTest2.addEventListener('click', async () => { await saveOnboardingKeys(); await updateOnboardStatus(); });
el.btnOnboardNext2.addEventListener('click', async () => { await saveOnboardingKeys(); showOnboardingStep(3); });
el.btnOnboardBack3.addEventListener('click', () => showOnboardingStep(2));
el.btnOnboardImportProfile.addEventListener('click', async () => {
  const r = await api.profileImport();
  if (r?.name) log(`<span class="ok">imported</span> ${r.name}`);
  if (profiles.reload) await profiles.reload(); else await profiles.initialize();
});
el.btnOnboardOpenProfileDir.addEventListener('click', async () => {
  const root = await api.profilesRoot();
  await api.openPath(root);
});
el.btnOnboardFinish.addEventListener('click', finishOnboarding);

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

    // Apply saved LLM provider choice (defaults to anthropic).
    const cfg = await api.configGetAll();
    applyLlmProvider(cfg.llm_provider || 'anthropic');

    // First-launch onboarding
    if (!cfg.onboarding_complete) {
      showOnboardingStep(1);
      await updateOnboardStatus();
      el.onboardBackdrop.classList.add('open');
    }
  } catch (err) {
    log(`boot failed: ${escapeHtml(err.message)}`, 'err');
  }
})();
