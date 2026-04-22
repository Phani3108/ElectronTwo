/**
 * Live Notes — user-entered notes that inject into subsequent generations.
 *
 * Two shapes:
 *   Plain:   "Wants system design experience"
 *   Tagged:  "role: Principal SWE"   "interviewer: Alice"   "focus: distributed systems"
 *
 * Tagged notes become a structured block in tier 2 context; plain notes
 * become a bullet list.
 *
 * The list is in-memory + mirrored to the session manager for persistence.
 */

export class LiveNotes {
  constructor({ bus }) {
    if (!bus) throw new Error('LiveNotes requires a bus');
    this._bus = bus;
    this._notes = []; // [{ id, text, ts, tag, value }]
  }

  add(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    const note = parseNote(trimmed);
    note.id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    note.ts = Date.now();
    this._notes.push(note);
    this._bus.emit('notes:changed', { notes: this.all() });
    return note;
  }

  remove(id) {
    const before = this._notes.length;
    this._notes = this._notes.filter(n => n.id !== id);
    if (this._notes.length !== before) this._bus.emit('notes:changed', { notes: this.all() });
  }

  clear() {
    if (this._notes.length === 0) return;
    this._notes = [];
    this._bus.emit('notes:changed', { notes: this.all() });
  }

  all() { return this._notes.slice(); }

  /** Restore from persistence. */
  load(notes) {
    this._notes = Array.isArray(notes) ? notes.slice() : [];
    this._bus.emit('notes:changed', { notes: this.all() });
  }

  /** Returns a context block injected into the LLM prompt as tier 2. */
  asContextBlock() {
    if (this._notes.length === 0) return '';
    const tagged = this._notes.filter(n => n.tag);
    const plain = this._notes.filter(n => !n.tag);
    const parts = [];
    if (tagged.length) {
      parts.push('Tagged context:');
      for (const n of tagged) parts.push(`- ${n.tag}: ${n.value}`);
    }
    if (plain.length) {
      parts.push('Notes:');
      for (const n of plain) parts.push(`- ${n.text}`);
    }
    return parts.join('\n');
  }
}

/** "role: Principal SWE" → { tag: 'role', value: 'Principal SWE', text } */
function parseNote(text) {
  const m = /^([a-zA-Z][a-zA-Z0-9_-]{0,24})\s*:\s*(.+)$/.exec(text);
  if (m) return { text, tag: m[1].toLowerCase(), value: m[2].trim() };
  return { text, tag: null, value: null };
}
