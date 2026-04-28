/**
 * ManualGate — explicit spacebar gate for question→answer flow.
 *
 * Replaces the old "auto-draft on detected question" behaviour with a
 * deterministic 3-state cycle the user controls with one keystroke. This is
 * the right primitive for a real interview: you decide when a question
 * starts, you decide when to commit it to the model, and you can cancel
 * cleanly.
 *
 * States:
 *
 *   IDLE     — between questions. Mic may be running (transcripts are seen
 *              but ignored). Press space to begin.
 *
 *   LISTENING (Q#)  — capturing the next question. Final transcripts are
 *              accumulated into the question buffer. The Q counter just
 *              incremented. Press space again to stop & fire.
 *
 *   ANSWERING(Q#)   — orchestrator is streaming an answer. Pressing space
 *              cancels the current generation and resets to IDLE so you
 *              can start the next one.
 *
 * Auto-transition: on `llm:done`, ANSWERING → IDLE (so the next space starts
 * a brand new question without an extra cancel keystroke).
 *
 * Emissions:
 *   gate:state       { from, to, questionNumber }
 *   gate:listening   { questionNumber }
 *   gate:fire        { question, questionNumber }
 *   gate:reset       { questionNumber }
 */

const STATES = Object.freeze({ IDLE: 'IDLE', LISTENING: 'LISTENING', ANSWERING: 'ANSWERING' });

export class ManualGate {
  constructor({ bus, orchestrator }) {
    if (!bus || !orchestrator) throw new Error('ManualGate requires bus + orchestrator');
    this._bus = bus;
    this._orch = orchestrator;
    this._state = STATES.IDLE;
    this._qn = 0;
    this._buffer = '';

    bus.on('audio:transcript', (t) => this._onTranscript(t));
    bus.on('llm:done', () => this._onAnswerDone());
    bus.on('llm:aborted', () => this._onAnswerDone());
    bus.on('llm:error', () => this._onAnswerDone());
  }

  get state() { return this._state; }
  get questionNumber() { return this._qn; }
  get currentBuffer() { return this._buffer; }

  /** Spacebar entry point. */
  toggle() {
    if (this._state === STATES.IDLE) this._startListening();
    else if (this._state === STATES.LISTENING) this._fireOrAbort();
    else this._cancelAnswer();
  }

  /** Hard reset (e.g., Stop button). */
  reset() {
    if (this._state !== STATES.IDLE) {
      try { this._orch.cancel(); } catch {}
    }
    this._buffer = '';
    this._setState(STATES.IDLE, 'reset');
  }

  // ── transitions ─────────────────────────────────────────────────────
  _startListening() {
    this._qn += 1;
    this._buffer = '';
    this._setState(STATES.LISTENING, 'space');
    this._bus.emit('gate:listening', { questionNumber: this._qn });
  }

  _fireOrAbort() {
    const q = this._buffer.trim();
    if (!q) {
      // Nothing captured — go back to idle without burning a question number.
      this._qn = Math.max(0, this._qn - 1);
      this._setState(STATES.IDLE, 'empty_buffer');
      return;
    }
    this._setState(STATES.ANSWERING, 'space');
    this._bus.emit('gate:fire', { question: q, questionNumber: this._qn });
    try { this._orch.ask(q); } catch (err) { this._bus.emit('llm:error', { kind: 'gate_fire', message: err.message }); }
  }

  _cancelAnswer() {
    try { this._orch.cancel(); } catch {}
    this._setState(STATES.IDLE, 'cancel');
    this._bus.emit('gate:reset', { questionNumber: this._qn });
  }

  _onAnswerDone() {
    if (this._state === STATES.ANSWERING) {
      this._setState(STATES.IDLE, 'answer_done');
    }
  }

  _onTranscript(t) {
    if (this._state !== STATES.LISTENING) return;
    if (!t.is_final) return;
    this._buffer = (this._buffer + ' ' + t.text).trim();
  }

  _setState(next, reason) {
    if (this._state === next) return;
    const from = this._state;
    this._state = next;
    this._bus.emit('gate:state', { from, to: next, reason, questionNumber: this._qn });
  }
}

ManualGate.STATES = STATES;
