# Example profiles

Importable profile bundles. Open ElectronTwo → ⚙ Settings → **Import profile…** and pick the JSON.

| File | Use case | Stories |
|---|---|---|
| [`stripe-em.profile.json`](stripe-em.profile.json) | Stripe Engineering Manager interview prep — Experience & Goals + Strategy & Execution rounds. Payments / HDFC / PayZapp framing. | 46 |

## Format

See [`SHARED/PROFILE.md`](../SHARED/PROFILE.md) for the canonical schema.

Each story carries `**Question pattern:**` + `**Answer in my voice:**` + `**Tags:**` so the RAG retriever matches both the asker's vocabulary and the prepared answer's substance — and the LLM is instructed to deliver near-verbatim when the pattern matches.
