import type { ShooterSettings } from "./settings";

type SfxName =
  | "fire"
  | "hit"
  | "damage"
  | "reload"
  | "jump"
  | "switch"
  | "spawn"
  | "kill"
  | "empty"
  | "click";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private volumes = { master: 0.8, sfx: 0.9, music: 0.5 };

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.applyVolumes();
    } catch {
      return null;
    }
    return this.ctx;
  }

  resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  setVolumes(s: ShooterSettings) {
    this.volumes = { master: s.masterVol, sfx: s.sfxVol, music: s.musicVol };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master?.gain.setTargetAtTime(this.volumes.master, t, 0.03);
    this.sfxBus?.gain.setTargetAtTime(this.volumes.sfx, t, 0.03);
    this.musicBus?.gain.setTargetAtTime(this.volumes.music, t, 0.03);
  }

  play(name: SfxName) {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    switch (name) {
      case "fire": {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.32, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.connect(g).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.1);
        noiseBurst(ctx, this.sfxBus, now, 0.07, 0.5);
        break;
      }
      case "hit": {
        noiseBurst(ctx, this.sfxBus, now, 0.03, 0.45, 2600);
        break;
      }
      case "damage": {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.18);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
      case "reload": {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.22);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.connect(g).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.26);
        click(ctx, this.sfxBus, now + 0.16, 0.2);
        click(ctx, this.sfxBus, now + 0.26, 0.18);
        break;
      }
      case "jump": {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(460, now + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        osc.connect(g).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.14);
        break;
      }
      case "switch": {
        click(ctx, this.sfxBus, now, 0.26);
        click(ctx, this.sfxBus, now + 0.07, 0.2);
        break;
      }
      case "spawn": {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(700, now + 0.16);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.1, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
      case "kill": {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.18);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.14, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(g).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.22);
        break;
      }
      case "empty": {
        click(ctx, this.sfxBus, now, 0.1, 700);
        break;
      }
      case "click": {
        click(ctx, this.sfxBus, now, 0.16);
        break;
      }
    }
  }

  /** Low, looped ambient pad during a match. Idempotent. */
  startMusic() {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || this.musicTimer !== null) return;
    const bus = ctx.createGain();
    bus.connect(this.musicBus);
    const makeDrone = (freq: number, type: OscillatorType, vol: number, offset = 0) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = Math.random() * 8 - 4;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 3);
      osc.connect(g).connect(bus);
      osc.start(ctx.currentTime + offset);
      return { osc, g };
    };
    const drones = [makeDrone(55, "sawtooth", 0.05), makeDrone(55.5, "sawtooth", 0.04), makeDrone(110, "triangle", 0.02, 1.5)];
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.15;
    lfo.connect(lfoG).connect(bus.gain);
    lfo.start();

    const fadeIn = setTimeout(() => bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 2), 200);
    this.musicTimer = window.setTimeout(() => {
      for (const d of drones) {
        d.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
        d.osc.stop(ctx.currentTime + 2.1);
      }
      lfoG.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
      lfo.stop(ctx.currentTime + 2.2);
      bus.disconnect();
      clearTimeout(fadeIn);
      lfo.disconnect();
      this.musicTimer = null;
    }, 900 * 1000);
    (this as any)._musicBus = bus;
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    const bus: GainNode | undefined = (this as any)._musicBus;
    if (bus && this.ctx) {
      bus.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.5);
      setTimeout(() => bus.disconnect(), 1600);
    }
    (this as any)._musicBus = undefined;
  }

  dispose() {
    this.stopMusic();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
  }
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  dur: number,
  vol: number,
  freq = 1800,
) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  src.connect(filter).connect(g).connect(dest);
  src.start(when);
  src.stop(when + dur + 0.01);
}

function click(ctx: AudioContext, dest: AudioNode, when: number, vol: number, freq = 900) {
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(180, when + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + 0.07);
}

export const audio = new AudioEngine();