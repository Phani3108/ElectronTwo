# The Plan

One document. We execute against it until both desktop and Android ship. No scope changes without updating this file and a deliberate decision.

## What we're building

Two products that share an orchestrator:

- **ElectronTwo (Desktop, macOS)**: invisible-to-screen-share overlay for video-call interviews. Text drafts on screen.
- **ShadowTwo (Android)**: earbud shadowing copilot for voice calls in WhatsApp/Zoom/Meet/Signal/in-person. AI whispers answers; user repeats aloud in own voice.

**Shared core**: profile-as-corpus, RAG over atomic stories, layered prompt assembly, few-shot voice, event bus.

## Non-goals (V1 — locked)

- iOS — not a target
- Windows / Linux / Web — not targets
- Coding-screenshot solver — different product
- Framework lens bar (13 chips) — prompt wrapper, not a feature
- Per-role "modes" (OPM, EM, etc.) — replaced by profiles
- Cloud backend / multi-user / sync — local-first, V2+
- Custom user-voice cloning — use preset AI voice for shadow
- Feature parity between desktop and mobile — they're different I/O shells

## Architectural invariants (we don't compromise these)

1. Audio pipeline is always a state machine with one owner. No scattered `let`s.
2. Every module declares its environment (desktop / mobile / shared).
3. All module-to-module comms via event bus. No direct references.
4. Profile is always a RAG corpus. Never dumped whole into prompt.
5. System prompt is always `cache_control`-enabled (tier 1 stable, tier 4 per-turn).
6. No settings UI during a call. All config is pre-call or post-call.
7. Every pipeline stage emits timing events. Observability from day 1.
8. Every failure terminates — either retries with cap, or surfaces to user. Never silent.
9. No prompt variants or mode toggles. Profiles are the only axis of variation.
10. No mid-plan feature additions without explicit decision recorded here.

## Phases

### Phase 0 — Foundation ✅ DONE

- Electron shell, event bus, AudioPipeline state machine, DeepgramTransport, minimal renderer.
- Commit: `scaffold: audio pipeline state machine + Deepgram transport`.

---

### Phase 1 — Desktop orchestrator (Week 1, 5 days)

**Scope:**
- Atomic-story RAG: profile decomposed into STAR/story units, embedded, indexed.
- Profile manager: load/switch profiles; each profile owns its own corpus + voice samples + role context.
- LLM orchestrator: layered prompt (identity · profile · retrieved stories · recent turns · question) with `cache_control` on stable tiers.
- Few-shot voice: 3–5 real answers in user's cadence embedded in tier 1.
- Streaming LLM with partial render; abort-safe.

**Acceptance:**
- TTFT (time-to-first-token) <400 ms p50, measured end-to-end.
- Profile switch via keystroke mid-session works.
- Answer cites source story ("pulled from: Zeta incident").
- 2-hour continuous uptime test: zero toggle-off / restart.

---

### Phase 2 — Desktop UX (Week 2, 5 days)

**Scope:**
- Pill UI (always-visible health dot) + expand-on-demand pane.
- Intent classifier on interim transcripts: is-question · to-me · urgency. Spacebar becomes override.
- Live notes panel with tagged entities auto-injected as tier 2 context.
- Session persistence + resume-on-restart.
- Health pre-flight on launch (mic, Deepgram, LLM, RAG) with green/red status in <2s.

**Acceptance:**
- 30-min real interview test: zero toggles required.
- Draft accuracy: user accepts ≥70% of drafts unmodified.
- Invisible on Zoom, Meet, Teams screen share — verified live.

---

### Phase 3 — Desktop hardening (Week 3, 3 days)

**Scope:**
- Fallback chains: Deepgram → Whisper local; cloud LLM → Ollama.
- Observability strip in pill (STT ms · LLM ms · RAG ms).
- Real-use bug sweep from Weeks 1–2 testing.
- .dmg packaging.

**Acceptance:**
- Installable .dmg, launches clean on a fresh machine.
- Works offline end-to-end via Ollama + local Whisper.
- 2-hour continuous use, zero degradation.

---

### Phase 4 — Mobile validation spike (Week 4, 2 days)

**Scope:**
- Kotlin skeleton Android app.
- `MediaProjection` + `AudioPlaybackCaptureConfiguration` to capture WhatsApp voice-call audio.
- WebSocket to OpenAI Realtime API; stream captured audio in.
- TTS response routed to earbud output stream only.
- Test with real WhatsApp call to a friend.

**Acceptance (go/no-go):**
- Capture works on WhatsApp call on Android 10+.
- Latency (call audio → AI response start): <600 ms.
- **Bleed test**: friend cannot hear AI voice at moderate volume with sealed earbuds.

**Kill criteria:**
- If bleed is unmanageable on commodity sealed buds → pivot to Rescue-mode-only product; drop Cue + Shadow from scope.
- If latency >1.2 s → pivot to text-only mobile ("whisper pane") instead of voice shadowing.

---

### Phase 5 — Android Rescue mode (Week 5, 5 days)

**Scope:**
- Floating overlay (`SYSTEM_ALERT_WINDOW`) with state dot + cue display.
- Foreground service with `FOREGROUND_SERVICE_MICROPHONE` + audio capture.
- Rescue UX: silent by default. VAD detects user pause >1.2s → whispers 3–4 word next beat.
- Profile manager (local JSON import from desktop for V1).
- On-device RAG (port embeddings/cosine-search from desktop).

**Acceptance:**
- Rescue mode works in a real WhatsApp call.
- 1 hour continuous use on a mid-range phone, battery OK.
- Bleed remains manageable with sealed buds.

---

### Phase 6 — Android Cue + Shadow modes (Week 6, 5 days)

**Scope:**
- Mode picker (Rescue / Cue / Shadow), switchable mid-call.
- Cue: keyword-beats TTS ("Zeta · 17 agents · senior pushback · trade-off").
- Shadow: full answer TTS with barge-in handling.
- Adaptive pacing: match TTS rate to user's shadowing rate.
- Bleed detection self-test on first launch.

**Acceptance:**
- All three modes work in real calls.
- Shadow mode bleed-free on sealed buds at moderate volume.
- Mid-call mode switch takes <1s.

---

### Phase 7 — Cross-device consolidation (Week 7, 5 days)

**Scope:**
- Extract shared orchestrator module (profile + RAG + prompt assembly) used by both products.
- Profile sync: desktop → phone via LAN WebSocket or QR-based bundle export.
- Session sync: call records from phone surfaced in desktop history view.
- Final polish + bug sweep.

**Acceptance:**
- One profile definition, both products use it.
- Session from either device is retrievable in one place.
- No feature regressions from Week 6.

---

### Phase 8 — Launch prep (Week 8, 3 days)

**Scope:**
- Signed .dmg for desktop.
- Signed APK for Android (sideload first; Play Store later if ever).
- Minimal onboarding: 3-screen flow (permissions · API keys · first profile).
- One-page user docs per product.

**Acceptance:**
- Fresh install to first working answer: <3 min.
- No manual configuration required beyond API keys.
- Both products ship.

---

## Timeline summary

| Phase | Scope | Days | Cumulative |
|---|---|---|---|
| 0 | Foundation | done | — |
| 1 | Desktop orchestrator | 5 | Day 5 |
| 2 | Desktop UX | 5 | Day 10 |
| 3 | Desktop hardening | 3 | Day 13 |
| 4 | Mobile spike (gate) | 2 | Day 15 |
| 5 | Android Rescue | 5 | Day 20 |
| 6 | Android Cue + Shadow | 5 | Day 25 |
| 7 | Consolidation | 5 | Day 30 |
| 8 | Launch | 3 | Day 33 |

**Total: 33 working days (~8 calendar weeks with 20% buffer).**

## Rules of engagement

1. **No mid-plan feature additions** without updating this file and a deliberate decision.
2. **Acceptance-test every phase before advancing.** Fail → fix or descope. No pushing forward with broken foundations.
3. **Kill criteria honored.** Phase 4 has a built-in pivot. Don't sunk-cost through it.
4. **Real-use tests required.** No synthetic benchmarks. Every phase validated in an actual meeting/call.
5. **Observability from day 1.** If a phase doesn't emit timings, it's not done.
6. **Lean commits.** Each phase lands in cohesive commits, not one mega-PR.
7. **Docs scoped minimally.** README per repo, this plan file, nothing else. Docs expand post-launch.
8. **One tracking thread.** Progress recorded here — check phase boxes as they complete.

## Repository layout

- `/Users/phani.m/Downloads/ElectronTwo/` — desktop (macOS Electron)
- `/Users/phani.m/Downloads/ShadowTwo/` — Android (Kotlin) — created at Phase 4
- Shared orchestrator extracted in Phase 7 to `/Users/phani.m/Downloads/Copilot-Core/` (or embedded in one, synced to other)

## Success definitions — "done" means

**Desktop done when:**
- Launch → all-green health status: <2s
- Draft TTFT: <400ms p50
- 2-hour run without touching: passes
- User accepts ≥70% of drafts unmodified in real interviews
- Invisible to screen share: verified on Zoom, Meet, Teams

**Mobile done when:**
- Install → first useful whispered response in a WhatsApp call: <3 min
- 1 hour run on mid-range Android, battery acceptable
- Rescue mode: silent-to-useful within 1.5s of user pause
- Shadow mode: bleed-free on sealed earbuds at moderate volume
- Verified on Android 10+ on 2 different devices

## Change log

- **Day 0 (Phase 0)**: scaffold committed. Audio pipeline, event bus, Deepgram transport, minimal renderer.
- **Phase 1**: profile manager, atomic-story RAG, layered prompt with cache_control, streaming LLM orchestrator.
- **Phase 2**: config store for keys, health pre-flight, intent classifier + auto-draft, live notes, session persistence, settings modal.
- **Phase 3**: fallback chains (Deepgram→Whisper, Anthropic→Ollama), observability strip, electron-builder packaging config.
- **Phase 4 (spike)**: ShadowTwo Android project scaffolded. Foreground service + MediaProjection capture + OpenAI Realtime WS + earbud-path playback + bleed self-test. Ready for on-device validation.
- **Phase 5**: Rescue mode on Android — dual-speaker STT (Deepgram × 2), conversation tracker, pause detector (1.2s), atomic-story RAG + embeddings ported from desktop, Anthropic Haiku cue generator, Android built-in TTS to earbud, floating overlay (SYSTEM_ALERT_WINDOW), mode picker + profile import. Shadow + Rescue coexist.
- **Phase 6**: Cue mode + mid-call mode switching + adaptive pacing + first-launch bleed test. Refactored to ModeHandler architecture (Rescue/Cue/Shadow as peer handlers sharing a capture layer). ACTION_SWITCH_MODE swaps handlers <1s without tearing down MediaProjection. CueBeatsGenerator emits "Zeta · 17 agents · senior pushback" style anchors for the user to expand. SpeechPacer tracks user WPM and adjusts TTS rate. Bleed verdict persisted in SharedPreferences; warning banner surfaces non-CLEAN results.
- Future entries go here. Any change to scope, acceptance, or timeline gets a dated line.
