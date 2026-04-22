/**
 * ElectronTwo — main process.
 *
 * Window + IPC for things the renderer can't do:
 *  - macOS mic permission
 *  - filesystem reads/writes (profiles, RAG cache)
 *  - outbound API calls that need server-side headers (embeddings)
 *
 * No business logic. Business logic lives in renderer modules.
 */

const { app, BrowserWindow, ipcMain, session, systemPreferences, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');

try { require('dotenv').config(); } catch {}

process.title = 'Helper'; // stealth in Activity Monitor

let mainWindow;
let isVisible = true;
const userDataPath = () => app.getPath('userData');

// ─── window ────────────────────────────────────────────────────────────
function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: 520,
    height: 680,
    x: width - 540,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); isVisible = false; }
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status !== 'granted') await systemPreferences.askForMediaAccess('microphone');
  }

  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));

  ensureDefaultProfile();

  createWindow();

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (isVisible) { mainWindow.hide(); isVisible = false; }
    else { mainWindow.show(); isVisible = true; }
  });

  globalShortcut.register('CommandOrControl+Shift+P', () => {
    mainWindow?.webContents.send('profile:cycle');
  });
});

// ─── env + mic IPC ─────────────────────────────────────────────────────
ipcMain.handle('get-env', (_e, key) => process.env[key]);

ipcMain.handle('get-mic-permission', () => {
  if (process.platform === 'darwin') return systemPreferences.getMediaAccessStatus('microphone');
  return 'granted';
});

ipcMain.handle('request-mic-permission', async () => {
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return granted ? 'granted' : 'denied';
  }
  return 'granted';
});

// ─── profile IO ────────────────────────────────────────────────────────
function profilesRoot() { return path.join(userDataPath(), 'profiles'); }
function profileDir(name) { return path.join(profilesRoot(), name); }
function storiesDir(name) { return path.join(profileDir(name), 'stories'); }

function ensureDefaultProfile() {
  const root = profilesRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  if (fs.readdirSync(root).length > 0) return;

  // Seed a minimal default profile so the app is usable from first launch.
  const name = 'default';
  const dir = profileDir(name);
  fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'identity.md'),
`# Identity

Replace this with one paragraph about yourself, written in first person — the voice the model should imitate.

Example:
I'm a principal engineer with 12 years of experience in distributed systems and developer tools. I've shipped to scale at Zeta and Atlassian, led teams of 5–15, and spend most of my energy on architecture, mentoring, and cross-functional ownership.
`);

  fs.writeFileSync(path.join(dir, 'role.md'),
`# Active Role Context

One paragraph describing what you're interviewing for right now. Company, role, what the interviewer is likely probing.

Example:
Interviewing at Stripe for Staff Engineer on the payments reliability team. They care about: large-scale on-call, incident leadership, trade-off reasoning, and pragmatic system design.
`);

  fs.writeFileSync(path.join(dir, 'voice-samples.md'),
`# Voice Samples

Few-shot examples in your real voice. 3–5 Q&A pairs. These teach tone and cadence better than any prompt rule.

## Q: Tell me about a hard technical decision you made.

A: At Zeta we had 17 agents in production and the orchestration layer was becoming a bottleneck — we'd see 30-second tail latencies during peak. I argued for pulling out a dedicated queue tier instead of scaling the existing monolith. Pushback from senior eng was fair: extra moving piece, more ops. I framed it as a trade-off, not a veto. We ran a two-week spike on the queue tier, compared p99 under load, and the data decided it. Shipped in six weeks. Tail dropped to 3s, and the queue tier is still running clean a year later.

## Q: Tell me about a time you disagreed with a manager.

A: My manager wanted to cut a refactor I'd scoped for Q3 — argued it was pure engineer-happiness work. I didn't fight it head-on. I pulled the last quarter's incident tickets and tagged the root causes, and 40% traced back to the exact subsystem I wanted to refactor. Sent him the breakdown with a scope that was half the original ask. He greenlit it that afternoon. Incidents from that area dropped to zero the next quarter. Lesson: don't argue tone, argue cost.
`);

  fs.writeFileSync(path.join(dir, 'stories', 'zeta-queue-tier.md'),
`# Zeta — Queue Tier Extraction

**Type:** Technical decision · Architecture · Trade-off reasoning
**When:** 2023, Q2–Q3, Zeta payments platform.
**Scale:** 17 agents, ~12K TPS peak, 30s tail latency before.

## Situation
Orchestration monolith handled fan-out to 17 autonomous agents. During peak checkout hours we'd see p99 spike to 30s. On-call was being paged weekly. Root cause: head-of-line blocking inside the orchestrator.

## What I did
Argued for pulling fan-out into a dedicated queue tier (NATS JetStream). Senior engineers pushed back — more ops surface. I reframed from "should we do this?" to "what's the trade-off?" Ran a 2-week spike with shadow traffic, measured p99 under peak, showed the queue tier held 3s p99 under the same load.

## Result
Shipped in 6 weeks. p99 dropped from 30s → 3s. Queue tier still running clean a year later. Orchestrator freed up to focus on policy, not transport.

## Insight
Framing as trade-off, not advocacy, unlocked the decision. Senior eng weren't against the idea — they were against the risk. Showing the data made the risk concrete.
`);

  fs.writeFileSync(path.join(dir, 'stories', 'cross-team-conflict.md'),
`# Cross-Team Conflict — Platform vs. Product

**Type:** Leadership · Conflict · Stakeholder management
**When:** 2022, Atlassian.

## Situation
Product team wanted a feature that required breaking a platform contract. Platform team (mine) said no. Escalated to director level twice. Tension was burning trust.

## What I did
Took the product PM to lunch and asked what they actually needed — not the feature, the outcome. Turned out they needed a specific telemetry signal, not the API change. I proposed a compromise: expose the signal via a read-only channel, no contract break. Wrote the one-pager that weekend. Got both teams on a call Monday, framed it as "here's what we all agreed to," not "my solution."

## Result
Signed off in the Monday meeting. Product shipped their feature in 3 weeks. Platform kept the contract. My manager pulled me aside after and said it was the cleanest cross-team resolution he'd seen that year.

## Insight
Conflict usually isn't about the ask — it's about the underlying need. Separating the two lets you find solutions that don't require anyone to lose.
`);

  fs.writeFileSync(path.join(dir, 'stories', 'hiring-bad-call.md'),
`# Hiring Mistake and Recovery

**Type:** Leadership · Failure · Recovery
**When:** 2021, team of 8.

## Situation
Hired a senior engineer who looked exceptional on paper and in loops. Three months in, clear pattern: deep individual work, allergic to collaboration. Team morale dropping. I'd sponsored the hire personally.

## What I did
Didn't hide from it. Owned it in a 1:1 with my manager — "I misjudged the fit." Ran a 30-day structured feedback loop with the engineer: specific behaviors, specific outcomes, weekly checkpoints. By day 40 it was clear the gap wasn't closing. Made the call to part ways and handled the transition personally.

## Result
Team stabilized in 6 weeks. Backfill was a better fit. I wrote up the postmortem for the eng leadership group — what I missed in the loop, what signals to weight more.

## Insight
Owning the mistake fast is cheaper than protecting the hire. And the loop is a signal detector, not a guarantee — I learned to weight collaboration signals over technical depth when they conflicted.
`);
}

ipcMain.handle('profile:list', () => {
  const root = profilesRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(n => {
    try { return fs.statSync(path.join(root, n)).isDirectory(); } catch { return false; }
  });
});

ipcMain.handle('profile:read', (_e, name) => {
  const dir = profileDir(name);
  if (!fs.existsSync(dir)) return null;
  const safeRead = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };
  const identity = safeRead(path.join(dir, 'identity.md'));
  const role = safeRead(path.join(dir, 'role.md'));
  const voice = safeRead(path.join(dir, 'voice-samples.md'));
  const stDir = storiesDir(name);
  const stories = [];
  if (fs.existsSync(stDir)) {
    for (const f of fs.readdirSync(stDir)) {
      if (!f.endsWith('.md')) continue;
      stories.push({ id: f.replace(/\.md$/, ''), path: f, content: safeRead(path.join(stDir, f)) });
    }
  }
  return { name, identity, role, voice, stories };
});

// ─── embeddings (OpenAI) ───────────────────────────────────────────────
ipcMain.handle('embeddings:compute', async (_e, texts) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: 'OPENAI_API_KEY missing' };
  try {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    });
    if (!resp.ok) return { error: `embeddings http ${resp.status}` };
    const json = await resp.json();
    return { vectors: json.data.map(d => d.embedding) };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── RAG cache (per-profile JSON on disk) ──────────────────────────────
function ragCachePath(profileName) {
  const dir = path.join(userDataPath(), 'rag-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${profileName}.json`);
}

ipcMain.handle('rag:load', (_e, profileName) => {
  try {
    const p = ragCachePath(profileName);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return null; }
});

ipcMain.handle('rag:save', (_e, profileName, payload) => {
  try {
    fs.writeFileSync(ragCachePath(profileName), JSON.stringify(payload), 'utf-8');
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

// ─── app lifecycle ─────────────────────────────────────────────────────
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
