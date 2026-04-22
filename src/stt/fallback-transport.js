/**
 * Fallback transport — tries each wrapped transport in order on connect().
 *
 * Semantics: if primary's connect() throws, we try secondary, etc.
 * Once connected, we stay on that transport until the pipeline closes it.
 * No auto-upgrade back to primary (V2 nicety).
 *
 * Emits `stt:transport-selected` on the bus so the UI can surface which
 * backend is active.
 */

export class FallbackTransport {
  /**
   * @param {object} opts
   * @param {object[]} opts.transports - ordered list of transports
   * @param {string[]} opts.names      - parallel array of human-readable names
   * @param {import('../bus/event-bus').EventBus} [opts.bus]
   */
  constructor({ transports, names, bus }) {
    if (!Array.isArray(transports) || transports.length === 0) throw new Error('fallback needs transports');
    this._transports = transports;
    this._names = names || transports.map((_, i) => `t${i}`);
    this._bus = bus;
  }

  async connect(args) {
    const errors = [];
    for (let i = 0; i < this._transports.length; i++) {
      try {
        const handle = await this._transports[i].connect(args);
        this._bus?.emit('stt:transport-selected', { name: this._names[i], fallback: i > 0 });
        return handle;
      } catch (err) {
        errors.push({ name: this._names[i], error: err.message });
        this._bus?.emit('stt:transport-failed', { name: this._names[i], reason: err.message });
      }
    }
    throw new Error(`all_transports_failed: ${JSON.stringify(errors)}`);
  }
}
