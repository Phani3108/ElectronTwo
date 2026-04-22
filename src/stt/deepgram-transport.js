/**
 * Deepgram transport. Implements the Transport contract used by AudioPipeline.
 *
 * Contract:
 *   await transport.connect({ stream, signal, onTranscript, onClose, onError })
 *     → { close(): Promise<void> }
 *
 * This module is vendor-specific and intentionally small. All reconnect /
 * retry / state logic lives in AudioPipeline — not here.
 */

const KEEPALIVE_MS = 10_000;
const DEFAULT_MODEL = 'nova-2';

class DeepgramTransport {
  /**
   * @param {object} opts
   * @param {() => Promise<string> | string} opts.getApiKey - lazy; fetched at connect
   * @param {object} [opts.options] - extra Deepgram query params
   */
  constructor({ getApiKey, options = {} }) {
    if (!getApiKey) throw new Error('DeepgramTransport requires getApiKey');
    this._getApiKey = getApiKey;
    this._options = {
      model: DEFAULT_MODEL,
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1000,
      vad_events: true,
      punctuate: true,
      endpointing: 300,
      ...options,
    };
  }

  async connect({ stream, signal, onTranscript, onClose, onError }) {
    const apiKey = await this._getApiKey();
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not configured');

    const url = `wss://api.deepgram.com/v1/listen?${new URLSearchParams(this._options).toString()}`;

    const ws = await openSocket(url, apiKey, signal);

    // Recorder chunks mic audio and pushes to socket
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    recorder.start(150);

    // Keepalive: Deepgram drops idle sockets after ~60s
    const keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, KEEPALIVE_MS);

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'Results') {
          const alt = data.channel?.alternatives?.[0];
          const text = alt?.transcript;
          if (text && text.trim()) {
            onTranscript({
              text,
              is_final: !!data.is_final,
              confidence: alt?.confidence ?? 1,
              ts: Date.now(),
            });
          }
        }
      } catch (err) {
        onError?.(err);
      }
    };

    ws.onerror = (evt) => { onError?.(new Error('websocket error')); };
    ws.onclose = (evt) => {
      clearInterval(keepAlive);
      onClose?.({ reason: `dg_close_${evt.code}`, code: evt.code, clean: evt.wasClean });
    };

    return {
      async close() {
        clearInterval(keepAlive);
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
        try { ws.close(1000, 'client_close'); } catch {}
      },
    };
  }
}

/** Open a WebSocket and resolve when it's open (or reject on error/abort). */
function openSocket(url, apiKey, signal) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, ['token', apiKey]);
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error('connect_aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    ws.onopen = () => {
      if (settled) { try { ws.close(); } catch {}; return; }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(ws);
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('websocket_connect_failed'));
    };
    ws.onclose = (evt) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`websocket_closed_${evt.code}`));
    };
  });
}

export { DeepgramTransport };
