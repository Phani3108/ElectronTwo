/**
 * LLM provider contract.
 *
 * Every provider exposes a single async-generator method:
 *   generate({ system, messages, maxTokens, temperature, signal })
 *     → yields { delta: string, usage?: object, done?: boolean }
 *
 * The orchestrator is provider-agnostic; fallback logic lives there.
 */

export class LLMProvider {
  /** @type {string} */
  name = 'base';
  /** @type {boolean} */
  isCloud = false;

  async *generate(_options) { // eslint-disable-line require-yield, no-unused-vars
    throw new Error('not implemented');
  }

  /** Returns { ok: boolean, reason?: string } */
  async probe() { return { ok: false, reason: 'not implemented' }; }
}
