import { getApiBaseUrl } from "../api.js";

export function getLiveTeachbackWsUrl(sessionId) {
  const httpBase = getApiBaseUrl();
  const wsBase = httpBase.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/ws/teachback/live?sessionId=${encodeURIComponent(sessionId)}`;
}

function downsampleTo16kPcm(float32Input, inputSampleRate) {
  const targetRate = 16000;
  const ratio = inputSampleRate / targetRate;
  const outputLength = Math.max(1, Math.round(float32Input.length / ratio));
  const pcm16 = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const idx = Math.min(float32Input.length - 1, Math.floor(i * ratio));
    const sample = Math.max(-1, Math.min(1, float32Input[idx]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm16;
}

function int16ToBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToFloat32Pcm(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000;
  }
  return float32;
}

/**
 * Captures mono microphone audio, downsamples to 16kHz 16-bit PCM, and emits base64 chunks.
 */
export async function startPcmMicCapture({ onPcmChunk, onLevel }) {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    if (typeof onLevel === "function") {
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      onLevel(Math.min(100, Math.round(rms * 350)));
    }
    const pcm16 = downsampleTo16kPcm(input, audioCtx.sampleRate);
    onPcmChunk(int16ToBase64(pcm16));
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  return {
    stop() {
      try {
        processor.disconnect();
        source.disconnect();
      } catch {
        // ignore
      }
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => {});
    },
  };
}

/**
 * Queued 24kHz PCM audio player with instant interruption/barge-in clearing.
 */
export function createPcmPlayer(sampleRate = 24000) {
  const AudioCtx =
    typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  let audioCtx = null;
  let nextPlayTime = 0;
  let activeSources = [];

  function ensureContext() {
    if (!audioCtx && AudioCtx) {
      audioCtx = new AudioCtx({ sampleRate });
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  return {
    enqueueBase64(base64) {
      const ctx = ensureContext();
      if (!ctx || !base64) return;
      try {
        const float32 = base64ToFloat32Pcm(base64);
        const buffer = ctx.createBuffer(1, float32.length, sampleRate);
        buffer.copyToChannel(float32, 0);

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);

        const now = ctx.currentTime;
        const startAt = Math.max(now + 0.02, nextPlayTime);
        src.start(startAt);
        nextPlayTime = startAt + buffer.duration;
        activeSources.push(src);
        src.onended = () => {
          activeSources = activeSources.filter((s) => s !== src);
        };
      } catch {
        // ignore malformed chunk
      }
    },
    clear() {
      for (const src of activeSources) {
        try {
          src.stop();
        } catch {
          // ignore
        }
      }
      activeSources = [];
      if (audioCtx) {
        nextPlayTime = audioCtx.currentTime;
      }
    },
    close() {
      this.clear();
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
    },
  };
}
