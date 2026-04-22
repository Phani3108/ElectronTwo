# Shared profile spec — Canonical

Both **ElectronTwo** (desktop) and **ShadowTwo** (Android) must speak the same profile format so the user can carry one corpus across devices.

This document is the single source of truth. Implementations on either side are verified against it.

## Canonical JSON schema

```jsonc
{
  "name": "string",               // identifier, used as filename/label
  "identity": "string",           // one paragraph, first-person, voice anchor
  "role": "string",               // one paragraph, active interview/role context
  "voiceSamples": "string",       // few-shot Q&A in user's real voice (3–5 pairs)
  "stories": [
    {
      "id": "string",             // slug; used for RAG citation
      "content": "string"         // one atomic STAR story; any length
    }
  ]
}
```

### Field contracts

- **name** — lowercased, hyphen-separated. Must be safe as a filename: `[a-z0-9_-]+`.
- **identity** — first-person prose. 1–3 sentences. The model reads this to anchor voice and scope.
- **role** — first-person prose describing who the user is interviewing for today. Changes per session.
- **voiceSamples** — Markdown allowed. Headings `## Q: …` + `A: …` pairs. 3–5 pairs is the sweet spot.
- **stories** — one atomic STAR story per record. Each is a retrieval unit; too-long stories get truncated, too-short ones rarely retrieve.
  - `id` — content-stable slug.
  - `content` — Markdown allowed. Include **project name**, **company**, **metric**, **timeframe** wherever possible.

## Desktop ↔ Android shape mapping

Desktop stores each profile as a tree of files for easy editing:

```
profiles/<name>/
  identity.md
  role.md
  voice-samples.md
  stories/
    <story-id>.md
    …
```

Android stores each profile as one JSON per profile at `filesDir/profiles/<name>.json`.

**Export** flattens the tree into a JSON bundle.
**Import** splits the JSON back into the tree (desktop) or writes directly (Android).

Both round-trip cleanly: `export(profile).then(import) == profile`.

## Behavior spec — prompt assembly

All generators use four tiers. Only tiers 1 + 2 are cached via `cache_control: ephemeral`; tiers 3 + 4 vary per turn.

| Tier | Content | Cached | Notes |
|---|---|---|---|
| 1 | Base instructions + `identity` + `voiceSamples` | yes | Stable per profile |
| 2 | `role` + live notes | yes | Stable per session |
| 3 | Retrieved stories (RAG top-K, K=3–4) + recent turns | no | Varies per question |
| 4 | Current question | no | The ask |

### RAG retrieval

- Corpus = `stories[]`; each story is one atomic record.
- Embeddings: OpenAI `text-embedding-3-small`.
- Index keyed by content hash so edits re-embed only the changed story.
- Cosine similarity, top-K = 3 (mobile rescue/cue) or 4 (desktop full).
- Cached per profile on disk.

### Cache invalidation

Any edit to tier 1 (identity, voice samples) or tier 2 (role, notes) invalidates the cache on the next call. Anthropic's cache_control handles the rest; we don't cache manually.

## Changes to this spec

This file is versioned with the plan. Any shape change must:
1. Bump the schema version (future — V2 adds `"version": 1`).
2. Update both implementations.
3. Ship a migration for existing profiles on both sides.

## Minimal example

```json
{
  "name": "staff-eng-stripe",
  "identity": "I'm a principal engineer with 12 years across distributed systems and dev tools — shipped at scale at Zeta and Atlassian, led teams of 5–15.",
  "role": "Interviewing at Stripe for Staff Engineer on payments reliability. They care about on-call leadership, trade-off reasoning, and pragmatic system design.",
  "voiceSamples": "## Q: Tell me about a hard technical decision.\nA: At Zeta we had 17 agents in prod and the orchestrator was the bottleneck — 30s tail latencies during peak. I argued for a dedicated queue tier against senior eng pushback — framed it as trade-off, not a veto. Two-week spike with shadow traffic decided it. Shipped in 6 weeks, p99 30s → 3s.",
  "stories": [
    {
      "id": "zeta-queue-tier",
      "content": "Zeta 2023 Q2 — 17 agents, 12K TPS peak, 30s tail. Argued for NATS JetStream queue tier against senior eng pushback. Spike with shadow traffic, 6-week delivery. p99 30s → 3s."
    }
  ]
}
```
