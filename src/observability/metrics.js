/**
 * Observability — tracks latency metrics from bus events and emits a rolling
 * summary for the UI strip. Nothing here is business logic; purely read-only.
 *
 * Tracked:
 *   STT  (transport connect time; also live gap between audio and first final)
 *   RAG  (search time)
 *   LLM  (TTFT + total)
 *
 * Emits `metrics:update` with p50 of last N samples per metric.
 */

const WINDOW = 10;

export class Metrics {
  constructor({ bus }) {
    if (!bus) throw new Error('Metrics requires a bus');
    this._bus = bus;
    this._samples = { stt_connect: [], rag: [], ttft: [], total: [] };
    this._last = {};

    bus.on('audio:timing', ({ label, ms }) => {
      if (label === 'transport_connect') this._add('stt_connect', ms);
      if (label === 'rag_search') this._add('rag', ms);
    });
    bus.on('llm:ttft', ({ ms }) => this._add('ttft', ms));
    bus.on('llm:done', ({ totalMs }) => this._add('total', totalMs));
  }

  _add(key, ms) {
    const arr = this._samples[key];
    arr.push(ms);
    if (arr.length > WINDOW) arr.shift();
    this._last[key] = ms;
    this._bus.emit('metrics:update', this.snapshot());
  }

  snapshot() {
    const out = { last: { ...this._last }, p50: {} };
    for (const [k, arr] of Object.entries(this._samples)) {
      out.p50[k] = arr.length ? median(arr) : null;
    }
    return out;
  }
}

function median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
