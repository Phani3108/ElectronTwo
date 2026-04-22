# ElectronTwo

Live-call AI copilot, rebuilt from scratch. Not a feature rewrite — an architectural reset.

## Intent

An invisible live-call copilot that drafts in-your-voice answers grounded in your own corpus, with zero babysitting for 90 minutes.

## Non-goals (V1)

- No framework chips / lens bar (prompt templates ≠ product)
- No per-role "modes" (replaced by profiles)
- No coding-screenshot solver (different product)
- No prescribed answer structure in system prompt (few-shot does it)
- No web/Windows (Mac-first, until the mac version is gold)

## Core shifts from v1

1. **Audio pipeline is an explicit state machine.** One owner of truth. Every transition tears down prior resources. No scattered `let isListening`.
2. **Intent detection is first-class.** VAD + diarization + question classifier on interim transcripts. Spacebar becomes override, not primary.
3. **Streaming prefetch, not request/response.** RAG + LLM fire at ~70% question completion. Target TTFT <400ms from end-of-speech.
4. **Layered cache-aware prompting.** Four tiers. Profile is a RAG corpus over atomic stories, never dumped.
5. **Voice via examples, not rules.** 3–5 few-shot answers replace all prescribed structure.
6. **Profile-as-corpus.** Each profile = its own RAG index + voice samples + role context. One-key swap. This is the real moat.

## Architecture

```
ScreenCaptureKit / mic  → [Audio Pipeline SM] → MediaStream
                               │
                               ▼
                          [STT Adapter] ──── Deepgram (primary)
                               │                Whisper local (fallback)
                               ▼
                          [Event Bus] ──── emits: transcript, state, timing
                               │
                               ▼
                          [Intent Classifier] (is-question · to-me · urgency)
                               │
                               ▼
                          [Speculative RAG] (continuous on partial)
                               │
                               ▼
                          [LLM Orchestrator] (layered prompt · cache_control)
                               │
                               ▼
                          [Renderer UI] (pill + expand pane)
```

Every stage emits timing events. UI shows live health strip.

## Directory layout

```
src/
  audio/          # audio pipeline state machine (mic → MediaStream)
  stt/            # speech-to-text adapters (Deepgram, Whisper, browser)
  intent/         # VAD / question classifier
  rag/            # atomic-story indexing + retrieval
  llm/            # providers + layered prompt assembly
  profile/        # profile manager (corpus + voice + role)
  bus/            # event bus
  state/          # shared store
  observability/  # timing + health
  renderer/       # UI shell (pill + pane)
main.js           # Electron shell
preload.js        # IPC bridge
```

## Gold-standard yardsticks

A user should be able to:
1. Launch and see green on mic, STT, LLM, RAG in <2s
2. Start a call with zero configuration
3. Get draft tokens within <400ms of question-end
4. See *why* this answer was chosen (which story cited)
5. Switch profile in one keystroke, mid-call
6. Run 2 hours without touching anything
7. Quit and find the session saved + indexed

If any of those isn't true, it's not gold standard.

## Build order

- [x] Scaffold
- [ ] Audio state machine + event bus (Day 1–2)
- [ ] Deepgram STT + fallback chain (Day 2–3)
- [ ] Intent classifier + diarization (Day 3–4)
- [ ] Atomic-story RAG + profile manager (Day 5–6)
- [ ] Layered prompt assembly + few-shot voice (Day 7)
- [ ] Streaming prefetch + partial render (Day 8)
- [ ] Pill UI + expand pane + notes (Day 9–10)
- [ ] Multi-profile switching (Day 11)
- [ ] Session persistence + resume (Day 12)
- [ ] Health pre-flight + observability strip (Day 13)
- [ ] Fallback chains + polish (Day 14–15)

Target: ~2,500 LOC. Current v1 is 4,534.

## Today

Day 1 scope: audio pipeline state machine with Deepgram transcription running end-to-end. No LLM yet, no RAG yet. Just prove the foundation is reliable.
