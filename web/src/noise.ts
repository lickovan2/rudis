import {
  GtcrnWorkletNode,
  RnnoiseWorkletNode,
  loadGtcrn,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorklet from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasm from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasm from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import gtcrnWorklet from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import gtcrnWasm from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";

/**
 * off     — чистый сигнал микрофона;
 * browser — встроенное шумоподавление браузера;
 * rnnoise — нейросеть RNNoise (лёгкая, режим по умолчанию);
 * gtcrn   — нейросеть GTCRN (чище, но тяжелее для процессора).
 */
export type NoiseMode = "off" | "browser" | "rnnoise" | "gtcrn";

export const noiseModes: { value: NoiseMode; label: string; hint: string }[] = [
  { value: "off", label: "Выключено", hint: "Микрофон передаётся как есть." },
  { value: "browser", label: "Стандартное", hint: "Встроенное шумоподавление браузера — слабое, но почти бесплатное." },
  {
    value: "rnnoise",
    label: "Лёгкое (RNNoise)",
    hint: "Нейросеть приглушает клавиатуру, вентилятор и гул. Для слабых компьютеров.",
  },
  {
    value: "gtcrn",
    label: "Нейросетевое (GTCRN)",
    hint: "Убирает шум почти полностью и сохраняет голос. Немного больше нагружает процессор.",
  },
];

export const DEFAULT_NOISE_MODE: NoiseMode = "gtcrn";

const MAKEUP_GAIN: Record<NoiseMode, number> = { off: 1, browser: 1, rnnoise: 1, gtcrn: 3 };

export const isAiMode =(m: NoiseMode) => m === "rnnoise" || m === "gtcrn";

export interface MicPipeline {
  /** Что уходит собеседникам: обработанный звук или исходный микрофон. */
  stream: MediaStream;
  mode: NoiseMode;
  dispose(): void;
}

// Модели и worklet-модули грузим один раз и переиспользуем.
const binaries = new Map<NoiseMode, Promise<ArrayBuffer>>();
const modules = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

function binary(mode: "rnnoise" | "gtcrn") {
  let p = binaries.get(mode);
  if (!p) {
    p =
      mode === "rnnoise"
        ? loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm })
        : loadGtcrn({ url: gtcrnWasm });
    p.catch(() => binaries.delete(mode));
    binaries.set(mode, p);
  }
  return p;
}

function worklet(ctx: AudioContext, url: string) {
  let perCtx = modules.get(ctx);
  if (!perCtx) modules.set(ctx, (perCtx = new Map()));
  let p = perCtx.get(url);
  if (!p) {
    p = ctx.audioWorklet.addModule(url);
    p.catch(() => perCtx!.delete(url));
    perCtx.set(url, p);
  }
  return p;
}

/** Ограничения getUserMedia: встроенное шумоподавление включаем только в режиме «Стандартное». */
export function micConstraints(mode: NoiseMode, deviceId: string): MediaTrackConstraints {
  return {
    deviceId: deviceId && deviceId !== "default" ? { ideal: deviceId } : undefined,
    channelCount: 1,
    echoCancellation: true,
    autoGainControl: mode !== "off",
    noiseSuppression: mode === "browser",
  };
}

/**
 * Собирает цепочку микрофон → нейросеть → поток для отправки.
 * AudioContext должен работать на 48 кГц — под эту частоту обе модели.
 */
export async function buildPipeline(
  ctx: AudioContext,
  raw: MediaStream,
  mode: NoiseMode,
): Promise<MicPipeline> {
  const stopRaw = () => raw.getTracks().forEach((t) => t.stop());
  if (!isAiMode(mode)) return { stream: raw, mode, dispose: stopRaw };

  if (!("audioWorklet" in ctx)) throw new Error("AudioWorklet не поддерживается");
  const [wasmBinary] = await Promise.all([
    binary(mode as "rnnoise" | "gtcrn"),
    worklet(ctx, mode === "rnnoise" ? rnnoiseWorklet : gtcrnWorklet),
  ]);

  const source = ctx.createMediaStreamSource(raw);
  const node =
    mode === "rnnoise"
      ? new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary })
      : new GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary });
  // GTCRN заметно приглушает и сам голос — возвращаем громкость, а лимитер не даёт перегруза.
  const makeup = ctx.createGain();
  makeup.gain.value = MAKEUP_GAIN[mode];
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 1;
  source.connect(node).connect(makeup).connect(limiter).connect(dest);

  return {
    stream: dest.stream,
    mode,
    dispose() {
      source.disconnect();
      node.disconnect();
      makeup.disconnect();
      limiter.disconnect();
      node.destroy();
      dest.stream.getTracks().forEach((t) => t.stop());
      stopRaw();
    },
  };
}
