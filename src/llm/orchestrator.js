/**
 * LLM Orchestrator — takes a question, runs RAG, builds the layered prompt,
 * streams tokens from Anthropic Claude, emits events on the bus.
 *
 * Emissions:
 *   llm:start         { question, at, retrievedIds }
 *   llm:token         { delta, at }
 *   llm:ttft          { ms }          — first token received
 *   llm:done          { fullText, totalMs, usage }
 *   llm:aborted       { reason }
 *   llm:error         { kind, message }
 *
 * Streaming: Anthropic SSE via fetch. AbortController cancels in-flight
 * requests (spacebar double-press, new question arrives).
 *
 * Model: defaults to claude-sonnet-4. Prompt caching via ephemeral blocks
 * (tier 1 + 2) is engaged in prompt-builder.
 */

import { buildAnthropicPayload } from './prompt-builder.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';
const RAG_K = 4;
const RECENT_TURNS = 3;

export class LLMOrchestrator {
  constructor({ bus, api, rag, profileManager, notes = null, model = DEFAULT_MODEL }) {
    if (!bus || !api || !rag || !profileManager) throw new Error('orchestrator missing deps');
    this._bus = bus;
    this._api = api;
    this._rag = rag;
    this._profiles = profileManager;
    this._notes = notes;
    this._model = model;
    this._recent = [];          // rolling last-N Q&A turns
    this._abort = null;
    this._current = 0;          // generation counter
  }

  setModel(model) { this._model = model; }

  clearHistory() { this._recent = []; }

  /** Fire a generation. Any in-flight call is aborted. */
  async ask(question) {
    const qn = question?.trim();
    if (!qn) return;

    // Abort any in-flight generation.
    this._abort?.abort();
    this._abort = new AbortController();
    const gen = ++this._current;

    const profile = this._profiles.active;
    if (!profile) {
      this._bus.emit('llm:error', { kind: 'no_profile', message: 'no active profile' });
      return;
    }

    const apiKey = await this._api.getEnv('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this._bus.emit('llm:error', { kind: 'no_key', message: 'ANTHROPIC_API_KEY missing' });
      return;
    }

    const t0 = performance.now();
    this._bus.emit('llm:start', { question: qn, at: t0 });

    let retrieved = [];
    try {
      retrieved = await this._rag.search(qn, RAG_K);
    } catch (err) {
      this._bus.emit('llm:error', { kind: 'rag', message: err.message });
    }

    if (gen !== this._current) return; // superseded during RAG

    const payload = buildAnthropicPayload({
      profile,
      retrievedStories: retrieved,
      recentTurns: this._recent.slice(-RECENT_TURNS),
      notesBlock: this._notes?.asContextBlock() || '',
      question: qn,
    });

    const body = {
      model: this._model,
      system: payload.system,
      messages: payload.messages,
      max_tokens: payload.max_tokens,
      temperature: payload.temperature,
      stream: true,
    };

    let resp;
    try {
      resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify(body),
        signal: this._abort.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') { this._bus.emit('llm:aborted', { reason: 'superseded' }); return; }
      this._bus.emit('llm:error', { kind: 'network', message: err.message });
      return;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this._bus.emit('llm:error', { kind: 'http', message: `HTTP ${resp.status}: ${text.substring(0, 400)}` });
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let firstTokenSeen = false;
    let usage = null;
    const retrievedIds = retrieved.map(r => ({ id: r.id, score: r.score }));
    this._bus.emit('llm:retrieved', { ids: retrievedIds });

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (gen !== this._current) { this._abort?.abort(); break; }
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
            const delta = evt.delta.text || '';
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              const ttft = performance.now() - t0;
              this._bus.emit('llm:ttft', { ms: ttft });
            }
            fullText += delta;
            this._bus.emit('llm:token', { delta });
          } else if (evt.type === 'message_delta' && evt.usage) {
            usage = { ...(usage || {}), ...evt.usage };
          } else if (evt.type === 'message_start' && evt.message?.usage) {
            usage = evt.message.usage;
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') { this._bus.emit('llm:aborted', { reason: 'superseded' }); return; }
      this._bus.emit('llm:error', { kind: 'stream', message: err.message });
      return;
    }

    if (gen !== this._current) return;

    this._recent.push({ question: qn, answer: fullText });
    if (this._recent.length > 10) this._recent = this._recent.slice(-10);

    this._bus.emit('llm:done', {
      fullText,
      totalMs: performance.now() - t0,
      usage,
      retrievedIds,
    });
  }

  cancel() {
    this._abort?.abort();
    this._current++;
  }
}
