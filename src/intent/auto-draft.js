/**
 * Auto-draft policy — decides when to fire the LLM.
 *
 * Strategy:
 *   - Accumulate final transcripts into a rolling question buffer.
 *   - On each final transcript, classify intent.
 *   - If confidence ≥ 0.75: schedule a draft after 400ms of silence
 *     (debounced — new transcript arriving cancels and re-schedules).
 *   - Spacebar override: force draft now with current buffer,
 *     OR cancel in-flight draft.
 *
 * Emissions:
 *   intent:classified  { confidence, reasons, urgency, isQuestion, text }
 *   intent:draft-queued { text, in_ms }
 *   intent:draft-cancelled { reason }
 */

import { classifyIntent } from './classifier.js';

const AUTO_DRAFT_DELAY_MS = 400;
const BUFFER_MAX_CHARS = 800;
const BUFFER_DECAY_MS = 12_000; // clear buffer if nothing new for 12s

export class AutoDrafter {
  constructor({ bus, orchestrator }) {
    if (!bus || !orchestrator) throw new Error('AutoDrafter requires bus + orchestrator');
    this._bus = bus;
    this._orchestrator = orchestrator;
    this._enabled = false;
    this._buffer = '';
    this._lastAddTs = 0;
    this._draftTimer = null;
    this._lastDrafted = '';

    this._bus.on('audio:transcript', (t) => this._onTranscript(t));
  }

  setEnabled(on) {
    this._enabled = !!on;
    this._bus.emit('intent:mode', { enabled: this._enabled });
    if (!on) this._cancelDraftTimer('disabled');
  }

  get enabled() { return this._enabled; }

  /** Spacebar: force draft now with current buffer (or cancel if drafting). */
  forceDraftOrCancel() {
    if (this._draftTimer) { this._cancelDraftTimer('user_override'); return; }
    const text = this._buffer.trim();
    if (!text) return;
    this._fireDraft(text, 'force');
  }

  clearBuffer() {
    this._buffer = '';
    this._cancelDraftTimer('buffer_cleared');
  }

  _onTranscript(t) {
    if (!t.is_final) return;

    // Buffer decay: if last add was long ago, treat as a fresh question.
    if (Date.now() - this._lastAddTs > BUFFER_DECAY_MS) this._buffer = '';
    this._buffer = (this._buffer + ' ' + t.text).trim();
    if (this._buffer.length > BUFFER_MAX_CHARS) {
      this._buffer = this._buffer.slice(-BUFFER_MAX_CHARS);
    }
    this._lastAddTs = Date.now();

    const intent = classifyIntent(this._buffer);
    this._bus.emit('intent:classified', { ...intent, text: this._buffer });

    if (!this._enabled) return;
    if (!intent.isQuestion || intent.urgency !== 'high') return;
    if (this._buffer === this._lastDrafted) return;

    this._scheduleDraft(this._buffer);
  }

  _scheduleDraft(text) {
    this._cancelDraftTimer('resched');
    this._bus.emit('intent:draft-queued', { text, in_ms: AUTO_DRAFT_DELAY_MS });
    this._draftTimer = setTimeout(() => {
      this._draftTimer = null;
      this._fireDraft(text, 'auto');
    }, AUTO_DRAFT_DELAY_MS);
  }

  _cancelDraftTimer(reason) {
    if (!this._draftTimer) return;
    clearTimeout(this._draftTimer);
    this._draftTimer = null;
    this._bus.emit('intent:draft-cancelled', { reason });
  }

  _fireDraft(text, source) {
    this._lastDrafted = text;
    this._bus.emit('intent:draft-firing', { text, source });
    this._orchestrator.ask(text);
  }
}
