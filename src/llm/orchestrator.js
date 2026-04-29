/**
 * LLM Orchestrator — provider-agnostic.
 *
 * Flow:
 *   ask(question) → RAG search → build layered prompt → pick provider → stream
 *
 * Providers are tried in order. If the primary is unavailable (probe fails
 * at init, or a generate() throws a network error), we fall through to the
 * next. Currently: Anthropic → Ollama.
 *
 * Emissions:
 *   llm:start         { question, at }
 *   llm:retrieved     { ids: [{id, score}] }
 *   llm:provider      { name, fallback }
 *   llm:ttft          { ms }
 *   llm:token         { delta }
 *   llm:done          { fullText, totalMs, usage }
 *   llm:aborted       { reason }
 *   llm:error         { kind, message }
 */

import { buildAnthropicPayload } from './prompt-builder.js';

const RAG_K = 2;
const RECENT_TURNS = 3;

export class LLMOrchestrator {
  constructor({ bus, rag, profileManager, notes = null, providers = [] }) {
    if (!bus || !rag || !profileManager) throw new Error('orchestrator missing deps');
    if (!Array.isArray(providers) || providers.length === 0) throw new Error('orchestrator requires at least one provider');
    this._bus = bus;
    this._rag = rag;
    this._profiles = profileManager;
    this._notes = notes;
    this._providers = providers;
    this._recent = [];
    this._abort = null;
    this._current = 0;
  }

  /** Set the preferred provider order at runtime (e.g., switch to offline mode). */
  setProviderOrder(names) {
    const map = new Map(this._providers.map(p => [p.name, p]));
    this._providers = names.map(n => map.get(n)).filter(Boolean);
  }

  get providerOrder() { return this._providers.map(p => p.name); }

  clearHistory() { this._recent = []; }

  async ask(question) {
    const qn = question?.trim();
    if (!qn) return;

    this._abort?.abort();
    this._abort = new AbortController();
    const gen = ++this._current;

    const profile = this._profiles.active;
    if (!profile) { this._bus.emit('llm:error', { kind: 'no_profile', message: 'no active profile' }); return; }

    const t0 = performance.now();
    this._bus.emit('llm:start', { question: qn, at: t0 });

    let retrieved = [];
    try { retrieved = await this._rag.search(qn, RAG_K); }
    catch (err) { this._bus.emit('llm:error', { kind: 'rag', message: err.message }); }

    if (gen !== this._current) return;

    const payload = buildAnthropicPayload({
      profile,
      retrievedStories: retrieved,
      recentTurns: this._recent.slice(-RECENT_TURNS),
      notesBlock: this._notes?.asContextBlock() || '',
      question: qn,
    });

    const retrievedIds = retrieved.map(r => ({ id: r.id, score: r.score }));
    this._bus.emit('llm:retrieved', { ids: retrievedIds });

    // Try providers in order.
    let fullText = '';
    let firstTokenSeen = false;
    let usage = null;
    let lastError = null;

    for (let i = 0; i < this._providers.length; i++) {
      const provider = this._providers[i];
      const isFallback = i > 0;
      this._bus.emit('llm:provider', { name: provider.name, fallback: isFallback });
      try {
        for await (const evt of provider.generate({
          system: payload.system,
          messages: payload.messages,
          maxTokens: payload.max_tokens,
          temperature: payload.temperature,
          signal: this._abort.signal,
        })) {
          if (gen !== this._current) { this._abort?.abort(); break; }
          if (evt.delta) {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              this._bus.emit('llm:ttft', { ms: performance.now() - t0 });
            }
            fullText += evt.delta;
            this._bus.emit('llm:token', { delta: evt.delta });
          }
          if (evt.usage) usage = evt.usage;
          if (evt.done) break;
        }
        lastError = null;
        break; // success — stop trying further providers
      } catch (err) {
        if (err?.name === 'AbortError') { this._bus.emit('llm:aborted', { reason: 'superseded' }); return; }
        lastError = err;
        this._bus.emit('llm:error', { kind: `${provider.name}_failed`, message: err.message });
        // Try next provider if the primary barfed without producing output
        if (firstTokenSeen) break; // don't restart mid-stream
      }
    }

    if (gen !== this._current) return;

    if (lastError && !firstTokenSeen) {
      this._bus.emit('llm:error', { kind: 'all_providers_failed', message: lastError.message });
      return;
    }

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
