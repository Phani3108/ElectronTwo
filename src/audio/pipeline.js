/**
 * Audio Pipeline — single owner of audio capture + transport lifecycle.
 *
 * Why this exists: in v1, audio state was spread across 8 module-level `let`s,
 * two intervals, and closures inside ws.onopen. State was implicit. This class
 * is the explicit replacement: one state machine, one owner of teardown.
 *
 * State diagram:
 *
 *   IDLE ──start()──▶ REQUESTING_MIC ──ok──▶ CONNECTING ──open──▶ STREAMING
 *                          │                      │                  │
 *                       denied                 timeout            closed/ended
 *                          │                      │                  │
 *                          ▼                      ▼                  ▼
 *                        ERROR               RECONNECTING ◀──────────┘
 *                                              │
 *                                    max retries │      open
 *                                                ▼        │
 *                                              ERROR   STREAMING
 *
 *   Any state ──stop()──▶ STOPPING ──▶ STOPPED
 *
 * Events emitted on the bus:
 *   - `audio:state`       { from, to, reason }
 *   - `audio:transcript`  { text, is_final, confidence, ts }
 *   - `audio:error`       { kind, message, fatal }
 *   - `audio:timing`      { label, ms }
 *
 * The Transport is injected (Deepgram, Whisper, fake) so this module stays
 * free of vendor concerns. A Transport implements:
 *
 *   async transport.connect({ stream, onTranscript, onClose, onError, signal })
 *     → returns a handle: { close(): Promise<void>, send?(msg): void }
 */

const STATES = Object.freeze({
  IDLE: 'IDLE',
  REQUESTING_MIC: 'REQUESTING_MIC',
  CONNECTING: 'CONNECTING',
  STREAMING: 'STREAMING',
  RECONNECTING: 'RECONNECTING',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  ERROR: 'ERROR',
});

const CONNECT_TIMEOUT_MS = 8000;
const MAX_RECONNECT_ATTEMPTS = 12;
const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 10_000;

class AudioPipeline {
  /**
   * @param {object} opts
   * @param {import('../bus/event-bus').EventBus} opts.bus
   * @param {object} opts.transport - transport adapter (see module doc)
   * @param {() => object} [opts.getConstraints] - returns getUserMedia constraints
   */
  constructor({ bus, transport, getConstraints }) {
    if (!bus) throw new Error('AudioPipeline requires an EventBus');
    if (!transport) throw new Error('AudioPipeline requires a transport');

    this._bus = bus;
    this._transport = transport;
    this._getConstraints = getConstraints || (() => ({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));

    this._state = STATES.IDLE;
    this._stream = null;
    this._handle = null;         // transport handle with close()
    this._abortCtrl = null;      // aborts in-flight connect
    this._reconnectTimer = null;
    this._connectTimer = null;
    this._generation = 0;        // increments on every start/stop, stale callbacks bail
    this._attempts = 0;
    this._lastError = null;

    // Bound handlers so we can detach cleanly
    this._onTrackEnded = this._handleTrackEnded.bind(this);
    this._onVisibilityChange = this._handleVisibilityChange.bind(this);

    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  // ── public api ───────────────────────────────────────────────────────

  get state() { return this._state; }

  /** Start the pipeline. Idempotent-ish: calling while active is a no-op. */
  async start() {
    if (this._state !== STATES.IDLE && this._state !== STATES.STOPPED && this._state !== STATES.ERROR) {
      return;
    }
    this._generation++;
    this._attempts = 0;
    this._lastError = null;
    await this._acquireMic();
  }

  /** Stop and tear down. Safe from any state. */
  async stop() {
    if (this._state === STATES.STOPPED || this._state === STATES.IDLE) return;
    this._generation++; // invalidate any in-flight work
    await this._teardown('user stop');
    this._transition(STATES.STOPPED, 'user stop');
  }

  /** Release OS resources when app quits. */
  async dispose() {
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    await this.stop();
  }

  // ── internal: state transitions ──────────────────────────────────────

  _transition(next, reason) {
    if (this._state === next) return;
    const from = this._state;
    this._state = next;
    this._bus.emit('audio:state', { from, to: next, reason });
  }

  _emitError(kind, message, fatal = false) {
    this._lastError = { kind, message, fatal };
    this._bus.emit('audio:error', { kind, message, fatal });
    if (fatal) this._transition(STATES.ERROR, kind);
  }

  // ── internal: pipeline phases ────────────────────────────────────────

  async _acquireMic() {
    this._transition(STATES.REQUESTING_MIC, 'start');
    const gen = this._generation;
    const t0 = performance.now();
    try {
      const constraints = this._getConstraints();
      this._stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (gen !== this._generation) {
        // Stopped during acquisition — drop this stream.
        this._stream.getTracks().forEach(t => t.stop());
        this._stream = null;
        return;
      }
      // Detect device unplug / permission revoke
      this._stream.getTracks().forEach(t => { t.onended = this._onTrackEnded; });
      this._bus.emit('audio:timing', { label: 'mic_acquire', ms: performance.now() - t0 });
      await this._connect();
    } catch (err) {
      const kind = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
        ? 'permission_denied'
        : 'mic_unavailable';
      this._emitError(kind, err?.message || String(err), true);
    }
  }

  async _connect() {
    this._transition(STATES.CONNECTING, 'transport');
    const gen = this._generation;
    const t0 = performance.now();

    this._abortCtrl = new AbortController();

    // Hard timeout on connect — v1 would hang indefinitely
    this._connectTimer = setTimeout(() => {
      if (gen !== this._generation) return;
      this._abortCtrl?.abort();
      this._scheduleReconnect('connect_timeout');
    }, CONNECT_TIMEOUT_MS);

    try {
      const handle = await this._transport.connect({
        stream: this._stream,
        signal: this._abortCtrl.signal,
        onTranscript: (t) => {
          if (gen !== this._generation) return;
          this._bus.emit('audio:transcript', t);
        },
        onClose: (info) => {
          if (gen !== this._generation) return;
          if (this._state === STATES.STREAMING || this._state === STATES.CONNECTING) {
            this._scheduleReconnect(info?.reason || 'transport_closed');
          }
        },
        onError: (err) => {
          if (gen !== this._generation) return;
          this._bus.emit('audio:error', { kind: 'transport', message: err?.message || String(err), fatal: false });
        },
      });

      if (gen !== this._generation) {
        // Stopped while connecting — close the handle we just got.
        await handle.close().catch(() => {});
        return;
      }

      clearTimeout(this._connectTimer);
      this._handle = handle;
      this._attempts = 0;
      this._bus.emit('audio:timing', { label: 'transport_connect', ms: performance.now() - t0 });
      this._transition(STATES.STREAMING, 'connected');
    } catch (err) {
      clearTimeout(this._connectTimer);
      if (gen !== this._generation) return;
      this._scheduleReconnect(err?.message || 'connect_failed');
    }
  }

  _scheduleReconnect(reason) {
    // Tear down current transport handle before reconnecting.
    this._teardownTransport();

    if (this._attempts >= MAX_RECONNECT_ATTEMPTS) {
      this._emitError('reconnect_exhausted', `gave up after ${this._attempts} attempts (${reason})`, true);
      return;
    }

    this._transition(STATES.RECONNECTING, reason);
    const delay = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * Math.pow(2, Math.min(this._attempts, 5)));
    this._attempts++;

    const gen = this._generation;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      if (gen !== this._generation) return;
      // Reuse the existing stream if still live; otherwise re-acquire.
      const streamLive = this._stream && this._stream.getTracks().some(t => t.readyState === 'live');
      if (streamLive) this._connect();
      else this._acquireMic();
    }, delay);
  }

  // ── internal: teardown ───────────────────────────────────────────────

  async _teardown(reason) {
    this._transition(STATES.STOPPING, reason);
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._connectTimer);
    this._reconnectTimer = null;
    this._connectTimer = null;

    this._abortCtrl?.abort();
    this._abortCtrl = null;

    await this._teardownTransport();

    if (this._stream) {
      for (const t of this._stream.getTracks()) {
        t.onended = null;
        try { t.stop(); } catch {}
      }
      this._stream = null;
    }
  }

  async _teardownTransport() {
    if (!this._handle) return;
    const h = this._handle;
    this._handle = null;
    try { await h.close(); } catch (err) {
      // Non-fatal; transport already gone.
    }
  }

  // ── internal: edge handlers ──────────────────────────────────────────

  _handleTrackEnded() {
    // Device unplugged / permission revoked / OS suspended the track.
    if (this._state === STATES.STREAMING || this._state === STATES.CONNECTING) {
      // We need a fresh stream; current one is dead.
      if (this._stream) {
        this._stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
        this._stream = null;
      }
      this._scheduleReconnect('track_ended');
    }
  }

  _handleVisibilityChange() {
    // Chromium throttles timers on hidden windows; log it so the user
    // can correlate degradation in the health strip. We don't stop the
    // pipeline — hiding is the whole point of this app.
    this._bus.emit('audio:timing', {
      label: document.hidden ? 'window_hidden' : 'window_visible',
      ms: 0,
    });
  }
}

export { AudioPipeline, STATES };
