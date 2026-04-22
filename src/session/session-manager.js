/**
 * Session Manager — records a call's history + notes + transcript and
 * persists to disk. Debounced writes so we don't hammer disk on every token.
 *
 * A session = { id, startedAt, profile, transcript, history, notes }
 * where history is the rolling Q&A pairs from the orchestrator.
 *
 * Resumes from the most recent session on launch if started <6 hours ago.
 */

const SAVE_DEBOUNCE_MS = 1200;
const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

export class SessionManager {
  constructor({ bus, api, notes }) {
    if (!bus || !api || !notes) throw new Error('SessionManager missing deps');
    this._bus = bus;
    this._api = api;
    this._notes = notes;
    this._id = `s_${Date.now().toString(36)}`;
    this._startedAt = Date.now();
    this._profile = null;
    this._transcript = '';
    this._history = [];
    this._saveTimer = null;

    this._subscribe();
  }

  _subscribe() {
    this._bus.on('profile:changed', ({ name }) => { this._profile = name; this._scheduleSave(); });
    this._bus.on('audio:transcript', (t) => {
      if (t.is_final) { this._transcript += t.text + ' '; this._scheduleSave(); }
    });
    this._bus.on('llm:done', ({ fullText }) => {
      // Pair with the last asked question captured via llm:start
      if (this._pendingQ) {
        this._history.push({ q: this._pendingQ, a: fullText, ts: Date.now() });
        this._pendingQ = null;
        this._scheduleSave();
      }
    });
    this._bus.on('llm:start', ({ question }) => { this._pendingQ = question; });
    this._bus.on('notes:changed', () => this._scheduleSave());
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), SAVE_DEBOUNCE_MS);
  }

  async _save() {
    const payload = {
      id: this._id,
      startedAt: this._startedAt,
      savedAt: Date.now(),
      profile: this._profile,
      transcript: this._transcript,
      history: this._history,
      notes: this._notes.all(),
    };
    await this._api.sessionSave(this._id, payload).catch(() => {});
  }

  /** On boot: restore notes + history if a recent session exists. Transcript is not replayed. */
  async tryResume() {
    try {
      const latest = await this._api.sessionLoadLatest();
      if (!latest) return null;
      if (Date.now() - (latest.savedAt || 0) > RESUME_WINDOW_MS) return null;
      this._history = Array.isArray(latest.history) ? latest.history.slice() : [];
      if (Array.isArray(latest.notes)) this._notes.load(latest.notes);
      this._bus.emit('session:resumed', { id: latest.id, history: this._history, notes: latest.notes || [] });
      return latest;
    } catch {
      return null;
    }
  }

  /** Start a fresh session (new call). */
  reset() {
    this._id = `s_${Date.now().toString(36)}`;
    this._startedAt = Date.now();
    this._transcript = '';
    this._history = [];
    this._notes.clear();
    this._scheduleSave();
    this._bus.emit('session:reset', { id: this._id });
  }

  get id() { return this._id; }
}
