import { create } from "zustand";
import type { Socket } from "socket.io-client";
import { api } from "./api";
import { getSocket } from "./socket";
import { toast, useStore } from "./store";
import type { VoiceMember } from "./types";

interface VoiceUiState {
  channelId: string | null;
  serverId: string | null;
  status: "idle" | "connecting" | "connected";
  muted: boolean;
  deafened: boolean;
  // userId -> говорит ли сейчас (свой — под ключом "me").
  speaking: Record<string, boolean>;
  inputDeviceId: string;
  outputDeviceId: string;
  volume: Record<string, number>;
  // socketId -> состояние WebRTC-соединения с этим участником.
  links: Record<string, RTCPeerConnectionState>;
}

function loadPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(`rudis.voice.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(`rudis.voice.${key}`, value);
  } catch {
    /* ничего */
  }
}

export const useVoice = create<VoiceUiState>(() => ({
  channelId: null,
  serverId: null,
  status: "idle",
  muted: false,
  deafened: false,
  speaking: {},
  inputDeviceId: loadPref("input", "default"),
  outputDeviceId: loadPref("output", "default"),
  volume: {},
  links: {},
}));

const setV = useVoice.setState;
const getV = useVoice.getState;

type Signal =
  | { type: "offer" | "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit };

interface Peer {
  socketId: string;
  userId: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingIce: RTCIceCandidateInit[];
  stopMeter?: () => void;
}

const peers = new Map<string, Peer>();
let localStream: MediaStream | null = null;
let stopLocalMeter: (() => void) | null = null;
let iceServers: RTCIceServer[] = [];
let boundSocket: Socket | null = null;
let audioCtx: AudioContext | null = null;

function ctx() {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

// Короткий сигнал при входе/выходе, как в привычных голосовых чатах.
function chime(up: boolean) {
  try {
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    const t = c.currentTime;
    osc.frequency.setValueAtTime(up ? 520 : 660, t);
    osc.frequency.linearRampToValueAtTime(up ? 780 : 440, t + 0.15);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.26);
  } catch {
    /* без звука */
  }
}

function meter(stream: MediaStream, key: string): () => void {
  const c = ctx();
  const source = c.createMediaStreamSource(stream);
  const analyser = c.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let lastLoud = 0;
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();
    if (rms > 0.03) lastLoud = now;
    const talking = now - lastLoud < 300 && !(key === "me" && getV().muted);
    if (getV().speaking[key] !== talking)
      setV((s) => ({ speaking: { ...s.speaking, [key]: talking } }));
  }, 80);
  return () => {
    clearInterval(timer);
    source.disconnect();
    setV((s) => ({ speaking: { ...s.speaking, [key]: false } }));
  };
}

function send(to: string, data: Signal) {
  boundSocket?.emit("voice:signal", { to, data });
}

function applyOutput(audio: HTMLAudioElement) {
  const { outputDeviceId, deafened, volume } = getV();
  audio.muted = deafened;
  const peer = [...peers.values()].find((p) => p.audio === audio);
  audio.volume = peer ? (volume[peer.userId] ?? 1) : 1;
  const sink = (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
  if (sink && outputDeviceId) sink.call(audio, outputDeviceId).catch(() => {});
}

function createPeer(socketId: string, userId: string): Peer {
  const pc = new RTCPeerConnection({ iceServers });
  const audio = new Audio();
  audio.autoplay = true;
  const peer: Peer = { socketId, userId, pc, audio, pendingIce: [] };
  peers.set(socketId, peer);
  applyOutput(audio);

  localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream!));

  pc.onicecandidate = (e) => {
    if (e.candidate) send(socketId, { type: "ice", candidate: e.candidate.toJSON() });
  };
  pc.ontrack = (e) => {
    const [stream] = e.streams;
    if (!stream) return;
    audio.srcObject = stream;
    void audio.play().catch(() => {});
    peer.stopMeter?.();
    peer.stopMeter = meter(stream, userId);
  };
  pc.onconnectionstatechange = () => {
    if (peers.get(socketId) === peer)
      setV((s) => ({ links: { ...s.links, [socketId]: pc.connectionState } }));
    if (pc.connectionState === "failed") pc.restartIce();
  };
  return peer;
}

function closePeer(socketId: string) {
  const peer = peers.get(socketId);
  if (!peer) return;
  peer.stopMeter?.();
  peer.pc.close();
  peer.audio.srcObject = null;
  peers.delete(socketId);
  setV((s) => {
    const { [socketId]: _, ...links } = s.links;
    return { links };
  });
}

async function flushIce(peer: Peer) {
  for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
}

async function onSignal({ from, userId, data }: { from: string; userId: string; data: Signal }) {
  let peer = peers.get(from);
  if (data.type === "offer") {
    peer ??= createPeer(from, userId);
    await peer.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
    await flushIce(peer);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    send(from, { type: "answer", sdp: answer.sdp! });
  } else if (data.type === "answer" && peer) {
    await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    await flushIce(peer);
  } else if (data.type === "ice" && peer) {
    if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
    else peer.pendingIce.push(data.candidate);
  }
}

const onPeerLeft = ({ socketId }: { socketId: string }) => closePeer(socketId);
const onKicked = ({ channelId }: { channelId: string }) => {
  if (getV().channelId === channelId) {
    teardown();
    toast("Вы отключены от голосового канала", "info");
  }
};
// После переподключения сокета сервер нас уже забыл — заходим заново.
const onReconnect = () => {
  const { channelId, serverId } = getV();
  if (channelId && serverId) void joinVoice(channelId, serverId, true);
};

function bindSocket(socket: Socket) {
  if (boundSocket === socket) return;
  unbindSocket();
  boundSocket = socket;
  socket.on("voice:signal", onSignal);
  socket.on("voice:peer-left", onPeerLeft);
  socket.on("voice:kicked", onKicked);
  socket.on("connect", onReconnect);
}

function unbindSocket() {
  if (!boundSocket) return;
  boundSocket.off("voice:signal", onSignal);
  boundSocket.off("voice:peer-left", onPeerLeft);
  boundSocket.off("voice:kicked", onKicked);
  boundSocket.off("connect", onReconnect);
  boundSocket = null;
}

async function getMic(): Promise<MediaStream> {
  const { inputDeviceId } = getV();
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: inputDeviceId && inputDeviceId !== "default" ? { ideal: inputDeviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

export async function joinVoice(channelId: string, serverId: string, rejoin = false) {
  const socket = getSocket();
  if (!socket) return;
  if (!rejoin && getV().channelId === channelId) return;
  if (!rejoin && getV().channelId) leaveVoice(true);
  for (const id of [...peers.keys()]) closePeer(id);

  setV({ channelId, serverId, status: "connecting" });
  try {
    if (!localStream) {
      localStream = await getMic();
      stopLocalMeter = meter(localStream, "me");
    }
    applyMute();
    if (!iceServers.length)
      iceServers = (await api<{ iceServers: RTCIceServer[] }>("GET", "/api/voice/config")).iceServers;
  } catch (e) {
    teardown();
    const name = (e as DOMException).name;
    toast(
      name === "NotAllowedError"
        ? "Нет доступа к микрофону — разрешите его в настройках браузера"
        : name === "NotFoundError"
          ? "Микрофон не найден"
          : (e as Error).message,
    );
    return;
  }

  bindSocket(socket);
  socket.emit(
    "voice:join",
    { channelId },
    async (res: { error?: string; peers?: VoiceMember[] }) => {
      if (res.error || getV().channelId !== channelId) {
        if (res.error) {
          toast(res.error);
          teardown();
        }
        return;
      }
      setV({ status: "connected" });
      socket.emit("voice:update", { muted: getV().muted, deafened: getV().deafened });
      if (!rejoin) chime(true);
      // Новичок сам звонит всем, кто уже в канале.
      for (const p of res.peers ?? []) {
        const peer = createPeer(p.socketId, p.userId);
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        send(p.socketId, { type: "offer", sdp: offer.sdp! });
      }
    },
  );
}

function teardown() {
  for (const id of [...peers.keys()]) closePeer(id);
  stopLocalMeter?.();
  stopLocalMeter = null;
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  unbindSocket();
  setV({ channelId: null, serverId: null, status: "idle", speaking: {}, links: {} });
}

export function leaveVoice(silent = false) {
  if (!getV().channelId) return;
  getSocket()?.emit("voice:leave");
  teardown();
  if (!silent) chime(false);
}

function applyMute() {
  const { muted, deafened } = getV();
  localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted && !deafened));
  for (const p of peers.values()) applyOutput(p.audio);
}

function pushState() {
  applyMute();
  const { muted, deafened } = getV();
  getSocket()?.emit("voice:update", { muted, deafened });
}

export function toggleMute() {
  const { muted, deafened } = getV();
  // Включая микрофон при выключенном звуке, включаем и звук.
  if (deafened) setV({ muted: false, deafened: false });
  else setV({ muted: !muted });
  pushState();
}

export function toggleDeafen() {
  setV((s) => ({ deafened: !s.deafened }));
  pushState();
}

export function setUserVolume(userId: string, value: number) {
  setV((s) => ({ volume: { ...s.volume, [userId]: value } }));
  for (const p of peers.values()) if (p.userId === userId) applyOutput(p.audio);
}

export async function setInputDevice(deviceId: string) {
  setV({ inputDeviceId: deviceId });
  savePref("input", deviceId);
  if (!localStream) return;
  // Меняем микрофон на лету, не переподключаясь.
  const fresh = await getMic().catch(() => null);
  if (!fresh) return toast("Не удалось открыть выбранный микрофон");
  const track = fresh.getAudioTracks()[0];
  for (const p of peers.values()) {
    const sender = p.pc.getSenders().find((s) => s.track?.kind === "audio");
    await sender?.replaceTrack(track);
  }
  stopLocalMeter?.();
  localStream.getTracks().forEach((t) => t.stop());
  localStream = fresh;
  stopLocalMeter = meter(fresh, "me");
  applyMute();
}

export function setOutputDevice(deviceId: string) {
  setV({ outputDeviceId: deviceId });
  savePref("output", deviceId);
  for (const p of peers.values()) applyOutput(p.audio);
}

export async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((d) => d.kind === "audioinput"),
      outputs: devices.filter((d) => d.kind === "audiooutput"),
    };
  } catch {
    return { inputs: [], outputs: [] };
  }
}

// Вышли из аккаунта — выходим и из голоса.
useStore.subscribe((s, prev) => {
  if (prev.me && !s.me) leaveVoice(true);
});

window.addEventListener("beforeunload", () => leaveVoice(true));
