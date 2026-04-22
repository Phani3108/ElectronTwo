# 💻 ElectronTwo

**An invisible desktop copilot for live video interviews.**
Listens to your Zoom / Meet / Teams call, drafts answers grounded in your own stories in your own voice, and stays invisible to screen share.

> Companion to [Shadow](https://github.com/Phani3108/Shadow) — the Android earbud version for voice calls. Both share the same profile format and session history.

---

## ✨ Why this exists

- 🕶 **Invisible to screen share** — `setContentProtection(true)` means the window doesn't show in Zoom / Meet / Teams
- 🎙 **Manual or auto** — classifier detects questions with confidence; hit spacebar to override
- 📚 **Profile-as-corpus** — your stories are an atomic-story RAG index, not a prompt dump
- ⚡ **Cached prompts** — four-tier `cache_control` prompt, ~5× faster TTFT, ~90% cheaper
- 🗣 **Voice via examples, not rules** — few-shot samples in your real cadence replace "always use STAR" instructions
- 🔌 **Three LLM providers** — Anthropic Claude, Azure OpenAI, Ollama (local) — swap in one click
- 🧪 **Offline fallback** — Deepgram → local Whisper, cloud LLM → Ollama; flip a chip in the header
- 📊 **Observable by design** — timing strip shows STT · RAG · TTFT · Total live
- 📝 **Live notes** inject mid-call — `interviewer: Alice` becomes tier-2 context on every subsequent turn
- 📚 **Sessions** saved across device — imports phone (Shadow) sessions into one history view

---

## 🏗 Architecture

```
🎤 Mic / system audio
      │
      ▼
🛠 AudioPipeline (state machine)
      │
      ▼
🗣 STT Adapter   ── Deepgram (primary)
      │           └── Whisper local (fallback, @xenova/transformers)
      ▼
📬 EventBus ── emits: audio:state · audio:transcript · audio:timing · …
      │
      ▼
🧭 IntentClassifier  (is-question · to-me · urgency)
      │
      ▼
🔎 StoryRAG (top-K cosine over atomic STAR stories)
      │
      ▼
🧠 LLMOrchestrator
      │    ├── AnthropicProvider  (streaming, cache_control)
      │    ├── AzureOpenAIProvider  (streaming SSE, Azure resource + deployment)
      │    └── OllamaProvider  (localhost:11434)
      ▼
🖼 Renderer UI (pill + answer pane + notes + sessions + settings)
```

Every pipeline stage emits timing events. The UI observability strip reads them live.

---

## 🔑 Providers

| Role | Options |
|---|---|
| 🧠 **LLM** | Anthropic Claude · Azure OpenAI · Ollama (local) |
| 🔢 **Embeddings** | OpenAI · Azure OpenAI |
| 🗣 **STT** | Deepgram Nova-2 · local Whisper-tiny |

Swap any of them from the ⚙ settings modal. Each key row has inline **[Save]** and **[Test]** buttons — test pings the real service before you save.

---

## 🚀 Install & run

### From the .dmg

```bash
npm run dist            # → dist/ElectronTwo-0.0.1.dmg
```

Drag to Applications. First launch: right-click → **Open** once to bypass Gatekeeper (we don't notarize).

### From source

```bash
npm install
npm start
```

No env vars required — the onboarding flow walks you through key entry.

---

## 🧭 First-launch onboarding

Three-step modal, gated by `config.onboarding_complete`:

1. 🔐 **Permissions** — mic + stealth explainer
2. 🔑 **Keys** — Anthropic / OpenAI / Deepgram; Azure fields appear when you pick it as provider
3. 👤 **Profile** — a default profile is seeded; edit in your editor or import JSON

Skip anytime; revisit via ⚙ in the header.

---

## 🎛 Header controls

| Control | Purpose |
|---|---|
| 🟢 **Health dots** | mic · anthropic · openai · deepgram · ollama · azure |
| 👤 **profile** chip | Click or `⌘⇧P` to cycle profiles mid-session |
| 🤖 **auto / manual** | Auto drafts on high-confidence questions; manual waits for space |
| 📡 **online / offline** | Flip provider order to Ollama-first for no-network runs |
| 📝 **notes** | Toggle notes panel (tagged: `focus: distributed systems`) |
| 📚 **sessions** | View + import history (desktop 💻 + phone 📱) |
| ⚙️ **settings** | Keys + provider pickers + per-key Save/Test |

---

## ⌨️ Keyboard

| Keys | Action |
|---|---|
| `⌘⇧H` | Hide / show window |
| `⌘⇧P` | Cycle active profile |
| `⌘,`  | Open settings |
| `Space` | Force draft now (or cancel pending auto-draft) |

---

## 🗂 Profile format

One folder per profile, one file per story:

```
userData/profiles/<name>/
  identity.md         # one paragraph, first-person voice anchor
  role.md             # who you're interviewing for today
  voice-samples.md    # 3–5 few-shot Q&A in your real cadence
  stories/
    <story-id>.md     # one atomic STAR story per file
```

Round-trippable with the Shadow app via a single JSON bundle — see [SHARED/PROFILE.md](SHARED/PROFILE.md).

---

## 📂 Module map

| Path | Purpose |
|---|---|
| 🎵 `src/audio/pipeline.js` | State machine: IDLE → REQUESTING_MIC → CONNECTING → STREAMING → RECONNECTING → STOPPED |
| 🗣 `src/stt/deepgram-transport.js` | Primary STT via WebSocket |
| 🗣 `src/stt/whisper-transport.js` | Local Whisper fallback |
| 🗣 `src/stt/fallback-transport.js` | Try primary then secondary on connect |
| 🧭 `src/intent/classifier.js` | Rule-based question detector, <5 ms |
| 🧭 `src/intent/auto-draft.js` | Debounced draft trigger + spacebar override |
| 🔎 `src/rag/story-rag.js` | Cosine similarity on atomic stories + disk cache |
| 🧠 `src/llm/orchestrator.js` | Provider-agnostic, fallback chain, abort-safe |
| 🧠 `src/llm/prompt-builder.js` | Four-tier layered prompt with cache_control |
| 🧠 `src/llm/providers/` | Anthropic · Azure OpenAI · Ollama |
| 👤 `src/profile/profile-manager.js` | Load, cache, cycle |
| 📝 `src/notes/notes.js` | Live notes with tag parsing |
| 📚 `src/session/session-manager.js` | Debounced JSON persistence + resume |
| 📊 `src/observability/metrics.js` | Rolling p50s for the header strip |
| 🖼 `src/renderer/` | UI shell |
| 🚪 `main.js` | Electron shell + IPC (profile IO, embeddings, keys, sessions) |

---

## 📦 Build targets

- 🍎 **macOS** (Apple Silicon) via `electron-builder` — [package.json](package.json) has the config
- 🚫 Windows / Linux / Web — not targets for V1

Universal binary when codesigned; unsigned falls back to arm64-only.

---

## 📖 More docs

- 📘 [USER_GUIDE.md](USER_GUIDE.md) — end-user walkthrough, one page
- 📐 [SHARED/PROFILE.md](SHARED/PROFILE.md) — canonical profile schema
- 🗺 [PLAN.md](PLAN.md) — the 8-phase plan both products execute against

---

## 🔗 Companion repo

- 📱 [Shadow](https://github.com/Phani3108/Shadow) — Android earbud copilot for voice calls

---

## 🏷 Credits

Built by [Phani Marupaka](https://www.linkedin.com/in/phani-marupaka). MIT License.
