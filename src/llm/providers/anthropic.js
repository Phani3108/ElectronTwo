/**
 * Anthropic provider — streaming Claude via SSE.
 *
 * Uses prompt-caching (ephemeral cache_control on the system blocks).
 * The orchestrator supplies system blocks already tagged; this provider
 * just forwards them untouched.
 */

import { LLMProvider } from './base.js';

const URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class AnthropicProvider extends LLMProvider {
  name = 'anthropic';
  isCloud = true;

  constructor({ getApiKey, model = DEFAULT_MODEL }) {
    super();
    this._getApiKey = getApiKey;
    this._model = model;
  }

  setModel(m) { this._model = m; }

  async probe() {
    const key = await this._getApiKey();
    if (!key) return { ok: false, reason: 'missing_key' };
    try {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': VERSION },
        signal: AbortSignal.timeout(3500),
      });
      return r.ok ? { ok: true } : { ok: false, reason: `http_${r.status}` };
    } catch (err) {
      return { ok: false, reason: err.name || 'network_error' };
    }
  }

  async *generate({ system, messages, maxTokens = 1500, temperature = 0.7, signal }) {
    const key = await this._getApiKey();
    if (!key) throw new Error('no_anthropic_key');

    const body = {
      model: this._model,
      system,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    };

    const resp = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`anthropic_http_${resp.status}: ${text.substring(0, 300)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineEnd;
      while ((lineEnd = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          yield { delta: evt.delta.text || '' };
        } else if (evt.type === 'message_start' && evt.message?.usage) {
          usage = evt.message.usage;
        } else if (evt.type === 'message_delta' && evt.usage) {
          usage = { ...(usage || {}), ...evt.usage };
        }
      }
    }

    yield { delta: '', done: true, usage };
  }
}
