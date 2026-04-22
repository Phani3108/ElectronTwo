/**
 * Renderer — thin glue between UI and AudioPipeline.
 * No business logic here. Everything interesting is in the modules.
 */

import { EventBus } from '../bus/event-bus.js';
import { AudioPipeline, STATES } from '../audio/pipeline.js';
import { DeepgramTransport } from '../stt/deepgram-transport.js';

const bus = new EventBus();

const transport = new DeepgramTransport({
  getApiKey: () => window.api.getEnv('DEEPGRAM_API_KEY'),
});

const pipeline = new AudioPipeline({ bus, transport });

// ── UI wiring ───────────────────────────────────────────────────────────
const el = {
  dot: document.getElementById('health-dot'),
  stateLabel: document.getElementById('state-label'),
  start: document.getElementById('btn-start'),
  stop: document.getElementById('btn-stop'),
  transcript: document.getElementById('transcript'),
  log: document.getElementById('log'),
};

let finalText = '';
let interimText = '';

function renderTranscript() {
  el.transcript.innerHTML = escapeHtml(finalText) +
    (interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : '');
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function logLine(html) {
  const row = document.createElement('div');
  row.innerHTML = html;
  el.log.appendChild(row);
  el.log.scrollTop = el.log.scrollHeight;
  while (el.log.children.length > 80) el.log.removeChild(el.log.firstChild);
}

function healthFor(state) {
  if (state === STATES.STREAMING) return 'ok';
  if (state === STATES.ERROR) return 'err';
  if (state === STATES.IDLE || state === STATES.STOPPED) return '';
  return 'warn';
}

bus.on('audio:state', ({ from, to, reason }) => {
  el.stateLabel.textContent = to.replace(/_/g, ' ').toLowerCase();
  el.dot.className = 'dot ' + healthFor(to);
  logLine(`<span class="state-evt">state</span> ${from} → ${to}${reason ? ` <span style="opacity:.6">(${reason})</span>` : ''}`);
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
  logLine(`<span class="err">error${fatal ? ' [fatal]' : ''}</span> ${kind}: ${escapeHtml(message)}`);
});

bus.on('audio:timing', ({ label, ms }) => {
  if (ms > 0) logLine(`timing ${label}: ${Math.round(ms)}ms`);
  else logLine(`event ${label}`);
});

el.start.addEventListener('click', () => pipeline.start().catch(err => logLine(`start threw: ${err.message}`)));
el.stop.addEventListener('click', () => pipeline.stop());

window.addEventListener('beforeunload', () => pipeline.dispose());
