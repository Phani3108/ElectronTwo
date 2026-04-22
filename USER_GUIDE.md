# ElectronTwo — User Guide

One page. Get from install to a working answer in under 3 minutes.

## Install

**Option A — run from source** (fastest)
```bash
git clone <this repo>
cd ElectronTwo
npm install
npm start
```

**Option B — .dmg** (distribution)
```bash
npm run dist
# → dist/ElectronTwo-0.0.1.dmg
```
Open the .dmg and drag to Applications. First launch: right-click → Open (Gatekeeper needs one-time bypass unless you codesign/notarize).

## First launch (onboarding)

A 3-step modal walks you through it:

1. **Permissions** — macOS will prompt for microphone on first use. Grant it. The window is invisible to screen sharing (content protection on).
2. **API keys** — paste Anthropic (LLM), OpenAI (embeddings), Deepgram (STT). Stored locally in `userData/config.json`, never transmitted. The **Test keys** button pings each service and turns the dot green.
3. **Profile** — a default profile is seeded in `userData/profiles/default/`. Edit the `.md` files directly or click **Import profile…** to load one exported from another machine / the Android app.

After onboarding, the main window shows:
- **Header dots** — mic · anthropic · openai · deepgram · ollama (local, optional)
- **Profile** chip — click or `Cmd+Shift+P` to cycle profiles
- **Auto** / **Manual** toggle — auto drafts on detected questions, manual waits for spacebar
- **Online** / **Offline** toggle — flip provider order to Ollama-first for no-network use

## Daily flow

1. Click **Mic** (or click settings ⚙ first if keys need adjusting).
2. Start your video call. The overlay is invisible to Zoom / Meet / Teams screen share.
3. As the interviewer speaks, you'll see transcript + intent classification.
4. When a question is detected at high confidence (auto mode), the app drafts in <400ms.
5. Or hit space to force-draft the current transcript buffer.
6. Notes panel (📝): jot `interviewer: Alice` or `focus: distributed systems` — those inject into every subsequent prompt as tier-2 context.
7. Sessions are auto-saved; review later via the 📚 button.

## Session history

The 📚 panel lists every saved session — desktop 💻 and Android 📱 badges. Click to see:
- Profile used
- Full Q&A turns with mode tag (rescue/cue/shadow/desktop)
- Notes captured mid-call
- Full transcript

Import phone sessions via **Import phone session…** — they'll drop into the same list.

## Offline mode

1. `brew install ollama && ollama serve &`
2. `ollama pull llama3.1` (or any local model that fits your RAM)
3. Click the **online / offline** chip in the header — flips provider order.
4. STT falls back to local Whisper (≈40MB one-time download via `@xenova/transformers`).

## Troubleshooting

- **Mic stuck on warn** → System Settings › Privacy & Security › Microphone → enable ElectronTwo → restart.
- **Key dot red** → click ⚙ and re-paste + Test.
- **"No active profile"** → open profile folder via onboarding or settings; ensure at least one `.md` file exists.
- **Global shortcut `Cmd+Shift+H`** hides the window; same combo shows it again.

## Keyboard reference

| Keys | Action |
|---|---|
| `Cmd+Shift+H` | Hide / show window |
| `Cmd+Shift+P` | Cycle active profile |
| `Cmd+,`       | Settings |
| `Space`       | Force draft now (or cancel pending auto-draft) |
