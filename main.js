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

const { app, BrowserWindow, ipcMain, session, systemPreferences, globalShortcut, screen, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ConfigStore } = require('./src/config/config-store');

try { require('dotenv').config(); } catch {}

process.title = 'Helper'; // stealth in Activity Monitor

let mainWindow;
let isVisible = true;
let config; // ConfigStore, initialised after app.whenReady
const userDataPath = () => app.getPath('userData');

/** Read key from config store first, fall back to env. Renderer is the canonical source. */
function readKey(name) {
  return config?.get(name) || process.env[name];
}

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
  config = new ConfigStore(userDataPath());

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
ipcMain.handle('get-env', (_e, key) => readKey(key));

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

// ─── config (API keys + prefs) ─────────────────────────────────────────
ipcMain.handle('config:get-all', () => {
  const all = config.getAll();
  // Redact key VALUES on read — renderer only needs to know if set. Keys themselves
  // flow through `get-env` when the renderer actually needs to make an API call.
  const redacted = {};
  for (const [k, v] of Object.entries(all)) {
    if (typeof v === 'string' && /API_KEY$/i.test(k)) redacted[k] = v ? `set:${maskKey(v)}` : '';
    else redacted[k] = v;
  }
  return redacted;
});

ipcMain.handle('config:set', (_e, key, value) => {
  if (value === null || value === undefined || value === '') config.delete(key);
  else config.set(key, value);
  return true;
});

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '…';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

// ─── services:probe — health pre-flight ────────────────────────────────
ipcMain.handle('services:probe', async () => {
  const results = { mic: 'unknown', anthropic: 'unknown', openai: 'unknown', deepgram: 'unknown', ollama: 'unknown', azure: 'unknown' };

  // Mic (macOS only reports meaningful state)
  if (process.platform === 'darwin') {
    const st = systemPreferences.getMediaAccessStatus('microphone');
    results.mic = st === 'granted' ? 'ok' : st;
  } else {
    results.mic = 'ok';
  }

  const timeout = (ms) => AbortSignal.timeout(ms);
  const anth = readKey('ANTHROPIC_API_KEY');
  const oai = readKey('OPENAI_API_KEY');
  const dg = readKey('DEEPGRAM_API_KEY');

  const probes = [];

  if (!anth) results.anthropic = 'missing';
  else probes.push(fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': anth, 'anthropic-version': '2023-06-01' },
    signal: timeout(4000),
  }).then(r => { results.anthropic = r.ok ? 'ok' : `err_${r.status}`; })
    .catch(err => { results.anthropic = `err_${err.name}`; }));

  if (!oai) results.openai = 'missing';
  else probes.push(fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${oai}` },
    signal: timeout(4000),
  }).then(r => { results.openai = r.ok ? 'ok' : `err_${r.status}`; })
    .catch(err => { results.openai = `err_${err.name}`; }));

  if (!dg) results.deepgram = 'missing';
  else probes.push(fetch('https://api.deepgram.com/v1/projects', {
    headers: { 'Authorization': `Token ${dg}` },
    signal: timeout(4000),
  }).then(r => { results.deepgram = r.ok ? 'ok' : `err_${r.status}`; })
    .catch(err => { results.deepgram = `err_${err.name}`; }));

  // Ollama — local, optional. "missing" = not running; "ok" = reachable.
  probes.push(fetch('http://127.0.0.1:11434/api/tags', { signal: timeout(1500) })
    .then(r => { results.ollama = r.ok ? 'ok' : `err_${r.status}`; })
    .catch(() => { results.ollama = 'missing'; }));

  // Azure OpenAI — needs key + resource + chat deployment to probe
  const azKey = readKey('AZURE_OPENAI_API_KEY');
  const azRes = readKey('AZURE_OPENAI_RESOURCE');
  const azDep = readKey('AZURE_OPENAI_CHAT_DEPLOYMENT');
  const azVer = readKey('AZURE_OPENAI_API_VERSION') || '2024-08-01-preview';
  if (!azKey || !azRes || !azDep) results.azure = 'missing';
  else {
    const url = `https://${sanitizeAzureResource(azRes)}.openai.azure.com/openai/deployments/${encodeURIComponent(azDep)}/chat/completions?api-version=${encodeURIComponent(azVer)}`;
    probes.push(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': azKey },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: timeout(6000),
    }).then(r => { results.azure = r.ok ? 'ok' : `err_${r.status}`; })
      .catch(err => { results.azure = `err_${err.name}`; }));
  }

  await Promise.all(probes);
  return results;
});

// ─── key:test — test an individual key with optional override values ───
// Lets the settings UI test a key the user just typed (before Save) and
// surface the real status (not just "saved").
ipcMain.handle('key:test', async (_e, provider, overrides = {}) => {
  const t = AbortSignal.timeout.bind(AbortSignal);
  const g = (k) => (overrides[k] ?? readKey(k));
  try {
    if (provider === 'anthropic') {
      const key = g('ANTHROPIC_API_KEY');
      if (!key) return { ok: false, reason: 'missing_key' };
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: t(5000),
      });
      return r.ok ? { ok: true } : { ok: false, reason: `http_${r.status}` };
    }
    if (provider === 'openai') {
      const key = g('OPENAI_API_KEY');
      if (!key) return { ok: false, reason: 'missing_key' };
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }, signal: t(5000),
      });
      return r.ok ? { ok: true } : { ok: false, reason: `http_${r.status}` };
    }
    if (provider === 'deepgram') {
      const key = g('DEEPGRAM_API_KEY');
      if (!key) return { ok: false, reason: 'missing_key' };
      const r = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { 'Authorization': `Token ${key}` }, signal: t(5000),
      });
      return r.ok ? { ok: true } : { ok: false, reason: `http_${r.status}` };
    }
    if (provider === 'azure') {
      const key = g('AZURE_OPENAI_API_KEY');
      const res = g('AZURE_OPENAI_RESOURCE');
      const dep = g('AZURE_OPENAI_CHAT_DEPLOYMENT');
      const ver = g('AZURE_OPENAI_API_VERSION') || '2024-08-01-preview';
      if (!key) return { ok: false, reason: 'missing_key' };
      if (!res) return { ok: false, reason: 'missing_resource' };
      if (!dep) return { ok: false, reason: 'missing_deployment' };
      const url = `https://${sanitizeAzureResource(res)}.openai.azure.com/openai/deployments/${encodeURIComponent(dep)}/chat/completions?api-version=${encodeURIComponent(ver)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: t(8000),
      });
      if (r.ok) return { ok: true };
      const body = await r.text().catch(() => '');
      let msg = '';
      try { msg = JSON.parse(body)?.error?.message || body; } catch { msg = body; }
      return { ok: false, reason: `http_${r.status}`, detail: msg.substring(0, 200) };
    }
    if (provider === 'azure-embedding') {
      const key = g('AZURE_OPENAI_API_KEY');
      const res = g('AZURE_OPENAI_RESOURCE');
      const dep = g('AZURE_OPENAI_EMBEDDING_DEPLOYMENT');
      const ver = g('AZURE_OPENAI_API_VERSION') || '2024-08-01-preview';
      if (!key || !res || !dep) return { ok: false, reason: 'missing_fields' };
      const url = `https://${sanitizeAzureResource(res)}.openai.azure.com/openai/deployments/${encodeURIComponent(dep)}/embeddings?api-version=${encodeURIComponent(ver)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify({ input: ['hello'] }),
        signal: t(8000),
      });
      return r.ok ? { ok: true } : { ok: false, reason: `http_${r.status}` };
    }
    return { ok: false, reason: 'unknown_provider' };
  } catch (err) {
    return { ok: false, reason: err.name || err.message };
  }
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

ipcMain.handle('profiles:root', () => profilesRoot());

ipcMain.handle('open-path', (_e, target) => {
  if (!target) return false;
  shell.openPath(target);
  return true;
});

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

// ─── profile export / import (shared format, see SHARED/PROFILE.md) ────
// The desktop stores profiles as file trees for easy editing; Android stores
// them as a single JSON per profile. Export flattens to JSON (Android-shaped);
// import splits JSON back into the file tree.
ipcMain.handle('profile:export', async (_e, name) => {
  const dir = profileDir(name);
  if (!fs.existsSync(dir)) return { error: `no profile: ${name}` };
  const safeRead = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };
  const bundle = {
    name,
    identity: safeRead(path.join(dir, 'identity.md')),
    role: safeRead(path.join(dir, 'role.md')),
    voiceSamples: safeRead(path.join(dir, 'voice-samples.md')),
    stories: [],
  };
  const stDir = storiesDir(name);
  if (fs.existsSync(stDir)) {
    for (const f of fs.readdirSync(stDir).sort()) {
      if (!f.endsWith('.md')) continue;
      bundle.stories.push({ id: f.replace(/\.md$/, ''), content: safeRead(path.join(stDir, f)) });
    }
  }
  // Write to a user-chosen path.
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${name}.profile.json`,
    filters: [{ name: 'Profile JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8');
    return { path: result.filePath, storyCount: bundle.stories.length };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('profile:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Profile JSON', extensions: ['json'] }, { name: 'All', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
  const p = result.filePaths[0];
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (err) { return { error: `bad json: ${err.message}` }; }
  const rawName = (bundle.name || 'imported').toString().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 48) || 'imported';
  const dir = profileDir(rawName);
  fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });
  // Wipe existing stories for this profile (clean round-trip)
  for (const f of fs.readdirSync(path.join(dir, 'stories'))) {
    if (f.endsWith('.md')) fs.unlinkSync(path.join(dir, 'stories', f));
  }
  fs.writeFileSync(path.join(dir, 'identity.md'), bundle.identity || '');
  fs.writeFileSync(path.join(dir, 'role.md'), bundle.role || '');
  fs.writeFileSync(path.join(dir, 'voice-samples.md'), bundle.voiceSamples || '');
  const stories = Array.isArray(bundle.stories) ? bundle.stories : [];
  let i = 0;
  for (const s of stories) {
    const id = (s.id || `story-${i++}`).toString().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    fs.writeFileSync(path.join(dir, 'stories', `${id}.md`), s.content || '');
  }
  return { name: rawName, storyCount: stories.length };
});

// ─── embeddings (OpenAI or Azure) ──────────────────────────────────────
// Routes based on config.embedding_provider: "azure" | "openai" (default).
// Azure requires resource + embedding deployment + api-key.
function sanitizeAzureResource(raw) {
  return (raw || '').replace(/^https?:\/\//i, '').replace(/\.openai\.azure\.com.*$/i, '').trim();
}

ipcMain.handle('embeddings:compute', async (_e, texts) => {
  const provider = (config?.get('embedding_provider') || 'openai').toLowerCase();

  if (provider === 'azure') {
    const key = readKey('AZURE_OPENAI_API_KEY');
    const resource = readKey('AZURE_OPENAI_RESOURCE');
    const deployment = readKey('AZURE_OPENAI_EMBEDDING_DEPLOYMENT');
    const version = readKey('AZURE_OPENAI_API_VERSION') || '2024-08-01-preview';
    if (!key) return { error: 'AZURE_OPENAI_API_KEY missing' };
    if (!resource) return { error: 'AZURE_OPENAI_RESOURCE missing' };
    if (!deployment) return { error: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT missing' };
    const url = `https://${sanitizeAzureResource(resource)}.openai.azure.com/openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=${encodeURIComponent(version)}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify({ input: texts }),
      });
      if (!resp.ok) return { error: `azure embeddings http ${resp.status}` };
      const json = await resp.json();
      return { vectors: json.data.map(d => d.embedding) };
    } catch (err) {
      return { error: err.message };
    }
  }

  // Default: OpenAI
  const apiKey = readKey('OPENAI_API_KEY');
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

// ─── session persistence ───────────────────────────────────────────────
function sessionsDir() {
  const d = path.join(userDataPath(), 'sessions');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

ipcMain.handle('session:save', (_e, sessionId, payload) => {
  try {
    const safeId = String(sessionId).replace(/[^a-z0-9_-]/gi, '_');
    fs.writeFileSync(path.join(sessionsDir(), `${safeId}.json`), JSON.stringify(payload), 'utf-8');
    return true;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('session:load-latest', () => {
  try {
    const d = sessionsDir();
    const files = fs.readdirSync(d)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, mtime: fs.statSync(path.join(d, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return null;
    return JSON.parse(fs.readFileSync(path.join(d, files[0].f), 'utf-8'));
  } catch { return null; }
});

ipcMain.handle('session:list', () => {
  try {
    const d = sessionsDir();
    const files = fs.readdirSync(d).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8'));
        return {
          file: f,
          id: raw.id || f.replace(/\.json$/, ''),
          startedAt: raw.startedAt || 0,
          savedAt: raw.savedAt || 0,
          profile: raw.profile || '',
          source: raw.source || 'desktop',
          historyCount: Array.isArray(raw.history) ? raw.history.length : 0,
          notesCount: Array.isArray(raw.notes) ? raw.notes.length : 0,
          transcriptChars: (raw.transcript || '').length,
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch { return []; }
});

ipcMain.handle('session:read', (_e, file) => {
  try {
    const safe = String(file).replace(/[^a-z0-9_.-]/gi, '_');
    const full = path.join(sessionsDir(), safe);
    if (!fs.existsSync(full)) return null;
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch { return null; }
});

ipcMain.handle('session:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Session JSON', extensions: ['json'] }, { name: 'All', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
  const imported = [];
  for (const p of result.filePaths) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!raw.source) raw.source = 'android';
      const id = (raw.id || `imp_${Date.now().toString(36)}`).toString().replace(/[^a-z0-9_-]/gi, '_');
      const dest = path.join(sessionsDir(), `${id}.json`);
      fs.writeFileSync(dest, JSON.stringify(raw), 'utf-8');
      imported.push(id);
    } catch (err) { /* skip bad file */ }
  }
  return { imported };
});

// ─── app lifecycle ─────────────────────────────────────────────────────
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
