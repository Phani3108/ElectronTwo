/**
 * Atomic-story RAG — each story file is one retrieval unit.
 *
 * Why atomic stories: interviews have discrete, reusable units (one STAR per story).
 * Chunking at the paragraph level loses the story arc; dumping the full profile
 * poisons the prompt with irrelevant context. One-story-per-unit is the right
 * granularity for this job.
 *
 * Persistence: per-profile JSON cache on disk (vectors + text + source).
 * Indexing is keyed by content hash; editing a story re-embeds just that one.
 *
 * Cosine similarity, in-memory search. Corpora here are small (tens of stories),
 * no need for a vector DB.
 */

export class StoryRAG {
  constructor({ bus, api }) {
    if (!bus) throw new Error('StoryRAG requires a bus');
    if (!api) throw new Error('StoryRAG requires an api bridge');
    this._bus = bus;
    this._api = api;
    this._profileName = null;
    this._records = []; // [{ id, content, hash, vector, norm }]
  }

  /** Build or reuse the index for a profile. Called on profile:changed. */
  async indexProfile(profile) {
    const t0 = performance.now();
    this._profileName = profile.name;

    const cache = await this._api.ragLoad(profile.name);
    const cached = new Map((cache?.records || []).map(r => [r.id, r]));

    const next = [];
    const toEmbed = []; // parallel arrays: { idx, content, id }
    for (const s of profile.stories) {
      const hash = simpleHash(s.content);
      const prev = cached.get(s.id);
      if (prev && prev.hash === hash) {
        next.push(prev);
      } else {
        const record = { id: s.id, content: s.content, hash, vector: null, norm: 0 };
        next.push(record);
        toEmbed.push(record);
      }
    }

    if (toEmbed.length > 0) {
      const result = await this._api.embeddingsCompute(toEmbed.map(r => r.content));
      if (result?.error) {
        this._bus.emit('rag:error', { message: result.error });
        return;
      }
      for (let i = 0; i < toEmbed.length; i++) {
        const v = result.vectors[i];
        toEmbed[i].vector = v;
        toEmbed[i].norm = vecNorm(v);
      }
      await this._api.ragSave(profile.name, { records: next });
    }

    this._records = next;
    const ms = performance.now() - t0;
    this._bus.emit('rag:indexed', { profile: profile.name, count: next.length, ms, embedded: toEmbed.length });
  }

  /** Top-k search. Returns [{ id, content, score }]. */
  async search(query, k = 4) {
    if (this._records.length === 0) return [];
    const t0 = performance.now();
    const result = await this._api.embeddingsCompute([query]);
    if (result?.error) {
      this._bus.emit('rag:error', { message: result.error });
      return [];
    }
    const q = result.vectors[0];
    const qn = vecNorm(q);

    const scored = this._records
      .filter(r => r.vector && r.vector.length === q.length)
      .map(r => ({ id: r.id, content: r.content, score: dot(q, r.vector) / (qn * r.norm) }));

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k);
    this._bus.emit('audio:timing', { label: 'rag_search', ms: performance.now() - t0 });
    return top;
  }

  /** Reset internal state (e.g., on profile switch before indexing). */
  reset() {
    this._profileName = null;
    this._records = [];
  }
}

// ─── vector ops ────────────────────────────────────────────────────────
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function vecNorm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

// Cheap, stable content hash (non-cryptographic; good enough for cache keying).
function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
