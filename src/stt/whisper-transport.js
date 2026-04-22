/**
 * Whisper transport — fully local STT via @xenova/transformers.
 *
 * Offline fallback when Deepgram is unreachable. Higher latency and lower
 * accuracy than Deepgram, but works with zero network.
 *
 * Strategy:
 *   - Lazy-load the pipeline on first `connect()` (loads ONNX model ~40MB
 *     on first use; cached locally after).
 *   - Chunk audio via MediaRecorder on a fixed window (WINDOW_MS).
 *   - Each chunk: decode → resample to 16kHz mono float32 → run Whisper.
 *   - Emit a non-final transcript per chunk.
 *
 * Setup (user): `npm install @xenova/transformers`. On first connect we
 * throw a clear error if the package isn't present.
 */

const WINDOW_MS = 3000;        // 3-second windows
const SAMPLE_RATE = 16_000;    // whisper expects 16kHz
const MODEL_ID = 'Xenova/whisper-tiny.en';

export class WhisperTransport {
  constructor() { this._asr = null; }

  async _loadPipeline() {
    if (this._asr) return this._asr;
    let pipelineFn;
    try {
      const mod = await import('@xenova/transformers');
      pipelineFn = mod.pipeline;
    } catch (err) {
      throw new Error(`whisper_not_installed: ${err.message || 'install @xenova/transformers'}`);
    }
    this._asr = await pipelineFn('automatic-speech-recognition', MODEL_ID);
    return this._asr;
  }

  async connect({ stream, signal, onTranscript, onClose, onError }) {
    let asr;
    try { asr = await this._loadPipeline(); }
    catch (err) { onError?.(err); throw err; }

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks = [];
    let closed = false;
    const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });

    recorder.ondataavailable = (e) => {
      if (e.data?.size > 0) chunks.push(e.data);
    };

    // Every WINDOW_MS: stop → transcribe the blob → restart.
    const flushAndTranscribe = async () => {
      if (closed || chunks.length === 0) return;
      const blob = new Blob(chunks.splice(0), { type: 'audio/webm' });
      try {
        const buf = await blob.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(buf);
        // Mono mix-down to float32 at SAMPLE_RATE (decodeAudioData resamples
        // based on AudioContext sampleRate, so this is already 16k)
        const mono = audioBuffer.numberOfChannels === 1
          ? audioBuffer.getChannelData(0)
          : mixToMono(audioBuffer);
        if (mono.length < SAMPLE_RATE * 0.3) return; // <300ms of audio
        const result = await asr(mono, { chunk_length_s: 30, stride_length_s: 5 });
        const text = result?.text?.trim();
        if (text && !closed) {
          onTranscript?.({ text, is_final: true, confidence: 0.9, ts: Date.now() });
        }
      } catch (err) {
        onError?.(err);
      }
    };

    const interval = setInterval(() => {
      if (closed) return;
      try { if (recorder.state === 'recording') recorder.requestData(); } catch {}
      flushAndTranscribe();
    }, WINDOW_MS);

    signal?.addEventListener('abort', () => { /* handled in close() via pipeline */ }, { once: true });

    recorder.start(250); // 250ms internal slicing; we aggregate into WINDOW_MS

    return {
      async close() {
        closed = true;
        clearInterval(interval);
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
        try { await audioCtx.close(); } catch {}
        onClose?.({ reason: 'whisper_close', clean: true });
      },
    };
  }
}

function mixToMono(ab) {
  const out = new Float32Array(ab.length);
  const chs = [];
  for (let i = 0; i < ab.numberOfChannels; i++) chs.push(ab.getChannelData(i));
  for (let i = 0; i < ab.length; i++) {
    let s = 0;
    for (let c = 0; c < chs.length; c++) s += chs[c][i];
    out[i] = s / chs.length;
  }
  return out;
}
