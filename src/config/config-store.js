/**
 * Config store — main-process-side JSON file at userData/config.json.
 *
 * Holds API keys and user preferences persistently. Takes priority over
 * process.env when reading, so the frontend settings panel is the canonical
 * source. Minimal; no encryption yet (V2 → wrap with Electron safeStorage).
 */

const fs = require('fs');
const path = require('path');

class ConfigStore {
  constructor(userDataPath) {
    this._file = path.join(userDataPath, 'config.json');
    this._data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._file)) {
        return JSON.parse(fs.readFileSync(this._file, 'utf-8'));
      }
    } catch {}
    return {};
  }

  _save() {
    try {
      fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (err) {
      console.error('config save failed:', err.message);
    }
  }

  get(key) { return this._data[key]; }
  set(key, value) { this._data[key] = value; this._save(); }
  setMany(obj) { Object.assign(this._data, obj); this._save(); }
  delete(key) { delete this._data[key]; this._save(); }
  getAll() { return { ...this._data }; }
}

module.exports = { ConfigStore };
