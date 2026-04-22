/**
 * Ollama provider — local LLM via http://localhost:11434.
 *
 * Streaming uses Ollama's newline-delimited JSON format (not SSE).
 * Cache-control markers from the orchestrator are stripped here — Ollama
 * doesn't use them, and stable tiers help less on local anyway.
 */

import { LLMProvider } from './base.js';

const DEFAULT_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.1';

export class OllamaProvider extends LLMProvider {
  name = 'ollama';
  isCloud = false;

  constructor({ url = DEFAULT_URL, model = DEFAULT_MODEL } = {}) {
    super();
    this._url = url;
    this._model = model;
  }

  setModel(m) { this._model = m; }

  async probe() {
    try {
      const r = await fetch(`${this._url}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return { ok: false, reason: `http_${r.status}` };
      const data = await r.json();
      return { ok: true, models: (data.models || []).map(m => m.name) };
    } catch (err) {
      return { ok: false, reason: err.name || 'unreachable' };
    }
  }

  async *generate({ system, messages, maxTokens = 700, temperature = 0.7, signal }) {
    // Flatten Anthropic-style system blocks → single string.
    const systemText = Array.isArray(system)
      ? system.map(b => (typeof b === 'string' ? b : b.text || '')).join('\n\n')
      : (system || '');

    // Anthropic message content can be a string or block array; normalize.
    const msgs = messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text || '').join('\n'),
    }));
    // Prepend system as a single message since Ollama accepts it in the top-level field.
    const resp = await fetch(`${this._url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this._model,
        system: systemText,
        messages: msgs,
        stream: true,
        options: { temperature, num_predict: maxTokens },
      }),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ollama_http_${resp.status}: ${text.substring(0, 300)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let promptEval = 0;
    let evalCount = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineEnd;
      while ((lineEnd = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.message?.content) yield { delta: evt.message.content };
        if (evt.prompt_eval_count) promptEval = evt.prompt_eval_count;
        if (evt.eval_count) evalCount = evt.eval_count;
        if (evt.done) {
          yield { delta: '', done: true, usage: { input_tokens: promptEval, output_tokens: evalCount } };
          return;
        }
      }
    }
  }
}
