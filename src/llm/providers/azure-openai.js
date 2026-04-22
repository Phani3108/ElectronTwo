/**
 * Azure OpenAI provider — streaming chat completions.
 *
 * Endpoint:
 *   POST https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version={version}
 *   Header: api-key: <key>
 *
 * Response is OpenAI-compatible SSE; each `data: <json>` line carries
 * `choices[0].delta.content` for streaming tokens.
 *
 * System blocks with `cache_control` (Anthropic-style) are flattened to a
 * single system string here. Azure doesn't currently expose the same cache
 * primitive; user profile still benefits from its own local caching and
 * Azure's server-side optimizations.
 */

import { LLMProvider } from './base.js';

const DEFAULT_API_VERSION = '2024-08-01-preview';

export class AzureOpenAIProvider extends LLMProvider {
  name = 'azure';
  isCloud = true;

  constructor({ getConfig }) {
    super();
    if (!getConfig) throw new Error('AzureOpenAIProvider requires getConfig');
    this._getConfig = getConfig;
  }

  _sanitizeResource(raw) {
    return (raw || '')
      .replace(/^https?:\/\//i, '')
      .replace(/\.openai\.azure\.com.*$/i, '')
      .trim();
  }

  _buildUrl(resource, deployment, apiVersion) {
    const cleanRes = this._sanitizeResource(resource);
    const cleanDep = (deployment || '').trim();
    const cleanVer = (apiVersion || DEFAULT_API_VERSION).trim();
    return `https://${cleanRes}.openai.azure.com/openai/deployments/${encodeURIComponent(cleanDep)}/chat/completions?api-version=${encodeURIComponent(cleanVer)}`;
  }

  async probe() {
    const cfg = await this._getConfig();
    if (!cfg.AZURE_OPENAI_API_KEY) return { ok: false, reason: 'missing_key' };
    if (!cfg.AZURE_OPENAI_RESOURCE) return { ok: false, reason: 'missing_resource' };
    if (!cfg.AZURE_OPENAI_CHAT_DEPLOYMENT) return { ok: false, reason: 'missing_deployment' };
    try {
      const url = this._buildUrl(cfg.AZURE_OPENAI_RESOURCE, cfg.AZURE_OPENAI_CHAT_DEPLOYMENT, cfg.AZURE_OPENAI_API_VERSION);
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': cfg.AZURE_OPENAI_API_KEY },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(6000),
      });
      return r.ok ? { ok: true } : { ok: false, reason: `http_${r.status}` };
    } catch (err) {
      return { ok: false, reason: err.name || 'network_error' };
    }
  }

  async *generate({ system, messages, maxTokens = 700, temperature = 0.7, signal }) {
    const cfg = await this._getConfig();
    if (!cfg.AZURE_OPENAI_API_KEY) throw new Error('no_azure_key');
    if (!cfg.AZURE_OPENAI_RESOURCE) throw new Error('no_azure_resource');
    if (!cfg.AZURE_OPENAI_CHAT_DEPLOYMENT) throw new Error('no_azure_chat_deployment');

    // Flatten Anthropic-style system blocks → single system message (Azure ignores cache_control).
    const systemText = Array.isArray(system)
      ? system.map(b => (typeof b === 'string' ? b : b.text || '')).join('\n\n')
      : (system || '');

    const openaiMessages = [{ role: 'system', content: systemText }];
    for (const m of messages) {
      const content = typeof m.content === 'string' ? m.content : m.content.map(b => b.text || '').join('\n');
      openaiMessages.push({ role: m.role, content });
    }

    const url = this._buildUrl(cfg.AZURE_OPENAI_RESOURCE, cfg.AZURE_OPENAI_CHAT_DEPLOYMENT, cfg.AZURE_OPENAI_API_VERSION);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.AZURE_OPENAI_API_KEY },
      body: JSON.stringify({
        messages: openaiMessages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`azure_http_${resp.status}: ${text.substring(0, 300)}`);
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
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) yield { delta };
        if (evt.usage) usage = evt.usage;
      }
    }

    yield { delta: '', done: true, usage };
  }
}
