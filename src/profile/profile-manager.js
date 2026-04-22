/**
 * Profile Manager — loads, caches, and switches user profiles.
 *
 * A profile is a folder on disk:
 *   profiles/<name>/
 *     identity.md        — one paragraph, first-person, voice anchor
 *     role.md            — active role/company context (one paragraph)
 *     voice-samples.md   — 3–5 few-shot Q&A in the user's real voice
 *     stories/*.md       — one atomic story per file (the RAG corpus)
 *
 * The manager emits `profile:changed` on the bus when the active profile
 * is switched or first loaded. RAG and prompt layers listen to rebuild.
 */

export class ProfileManager {
  constructor({ bus, api }) {
    if (!bus) throw new Error('ProfileManager requires a bus');
    if (!api) throw new Error('ProfileManager requires an api bridge');
    this._bus = bus;
    this._api = api;
    this._names = [];
    this._active = null;
    this._cache = new Map(); // name → profile object
  }

  get active() { return this._active; }
  get names() { return this._names.slice(); }

  async initialize() {
    this._names = await this._api.profileList();
    if (this._names.length === 0) throw new Error('no profiles on disk');
    await this.switchTo(this._names[0]);
  }

  async switchTo(name) {
    if (!this._names.includes(name)) throw new Error(`unknown profile: ${name}`);
    let profile = this._cache.get(name);
    if (!profile) {
      profile = await this._api.profileRead(name);
      if (!profile) throw new Error(`profile read failed: ${name}`);
      this._cache.set(name, profile);
    }
    this._active = profile;
    this._bus.emit('profile:changed', { name, profile });
    return profile;
  }

  async cycle() {
    if (this._names.length < 2) return this._active;
    const i = this._names.indexOf(this._active?.name);
    const next = this._names[(i + 1) % this._names.length];
    return this.switchTo(next);
  }

  /** Invalidate cache (e.g., after edits on disk). Reloads active profile. */
  async reload() {
    const name = this._active?.name;
    this._cache.clear();
    if (name) await this.switchTo(name);
  }
}
