import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  UniversalCamera,
  Vector3,
} from "babylonjs";
import type { Room } from "colyseus.js";
import {
  PLAYER,
  WEAPONS,
  WEAPON_KEYS,
  getMap,
  type GameRoomState,
  type PlayerState,
  type KillFeedItem,
  MSG,
  applyMovement,
  createMoveState,
  type MoveState,
  type MatchEndMessage,
  type MapBox,
} from "@shooter/shared";
import { buildMap } from "./MapBuilder";
import { getArrayCallbacks, getInstanceCallbacks, getMapCallbacks } from "../schemaCallbacks";
import { getSettings, subscribeSettings, type ShooterSettings, type BindingId } from "../settings";
import { audio } from "../audio";
import { openSettingsPanel } from "../settingsPanel";

export interface GameAppOptions {
  onEnd: (msg: MatchEndMessage) => void;
  onQuit: () => void;
}

interface RemoteEntry {
  root: Mesh;
  target: Vector3;
  alive: boolean;
}

interface ViewModel {
  meshes: Mesh[];
  flash: Mesh[];
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class GameApp {
  private engine: Engine;
  private scene: Scene;
  private cam!: UniversalCamera;
  private sun!: DirectionalLight;
  private shadowGen: ShadowGenerator | null = null;
  private room: Room<GameRoomState>;
  private myUid: string;
  private opts: GameAppOptions;
  private settings: ShooterSettings = getSettings();
  private unsubSettings: () => void;

  private move: MoveState = createMoveState();
  private yaw = 0;
  private pitch = 0;
  private myAlive = false;
  private hotWeapon = 0;

  private keys = new Set<string>();
  private msec = 0;
  private seq = 0;
  private lastSent = 0;
  private jumpUntil = 0;
  private lastFireSoundAt = 0;

  private colliders: MapBox[] = [];
  private bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

  private remote = new Map<string, RemoteEntry>();
  private hudDone = false;

  private paused = false;
  private pauseMenu: HTMLElement | null = null;
  private reloadUntil = 0;
  private reloadDur = 0;
  private reloadBarEl: HTMLElement | null = null;
  private emptyUntil = 0;

  private ctl = { fire: false, firePrev: false, reloadEdge: false, reloadPrev: false, swapEdge: false, swapPrev: false, active: false };
  private pendingInput: ReturnType<GameApp["inputState"]> | null = null;

  constructor(canvas: HTMLCanvasElement, room: Room<GameRoomState>, myUid: string, opts: GameAppOptions) {
    this.myUid = myUid;
    this.opts = opts;
    this.room = room;
    window.__gameApp = this;

    this.engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
    this.scene = new Scene(this.engine);

    const map = getMap(room.state.mapId);
    if (map) {
      this.colliders = map.boxes.filter((b) => b.collidable);
      this.bounds = {
        minX: map.bounds.min.x,
        maxX: map.bounds.max.x,
        minZ: map.bounds.min.z,
        maxZ: map.bounds.max.z,
      };
    }
    this.setupScene(map);
    this.setupCamera();
    this.buildWeapons();
    this.setupInput();
    this.setupWiring();
    this.unsubSettings = subscribeSettings(() => this.applySettings());
    this.applySettings(true);

    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.tick(dt, now);
      this.scene.render();
    });
  }

  dispose() {
    this.unsubSettings();
    if (window.__gameApp === this) delete window.__gameApp;
    try {
      this.engine.stopRenderLoop();
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {}
    for (const r of this.remote.values()) r.root.dispose();
    this.remote.clear();
    this.scene.dispose();
    this.engine.dispose();
  }

  requestPointerLock() {
    const canvas = this.engine.getRenderingCanvas();
    if (canvas) canvas.requestPointerLock();
  }

  resumeFromPause() {
    this.paused = false;
    this.hidePauseMenu();
    audio.resume();
    this.requestPointerLock();
  }

  optQuit() {
    this.hidePauseMenu();
    const onQuit = this.opts.onQuit;
    this.dispose();
    onQuit();
  }

  // ---- settings ----

  private applySettings(force = false) {
    const s = getSettings();
    const prev = this.settings;
    this.settings = s;
    audio.setVolumes(s);

    if (force || s.fov !== prev.fov) this.cam.fov = (s.fov * Math.PI) / 180;

    const effScale = Math.min(2, Math.max(0.5, s.resolutionScale * (s.quality === "low" ? 0.75 : s.quality === "high" ? 1.15 : 1)));
    this.engine.setHardwareScalingLevel(1 / effScale);

    this.scene.fogEnabled = s.effects;
    if (force || s.shadows !== prev.shadows) this.applyShadows(s.shadows);

    const canvas = this.engine.getRenderingCanvas()!;
    if (s.fullscreen && !document.fullscreenElement) void canvas.requestFullscreen().catch(() => {});
    if (!s.fullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  private applyShadows(enabled: boolean) {
    if (enabled && !this.shadowGen) {
      this.shadowGen = new ShadowGenerator(1024, this.sun);
      for (const m of this.scene.meshes) {
        if (m.name === "ground") {
          m.receiveShadows = true;
        } else if (m.name.startsWith("box_") || m.name.startsWith("cyl_") || m.name.startsWith("p_")) {
          this.shadowGen.addShadowCaster(m);
          m.receiveShadows = true;
        }
      }
      this.shadowGen.usePercentageCloserFiltering = true;
    }
    if (this.shadowGen) (this.shadowGen.getShadowMap() as unknown as { setEnabled: (v: boolean) => void } | null)?.setEnabled(enabled);
  }

  // ---- scene ----

  private setupScene(map: ReturnType<typeof getMap>) {
    const scene = this.scene;
    if (map) {
      scene.clearColor = Color4.FromHexString(map.skyColor);
      scene.fogColor = Color3.FromHexString(map.skyColor);
      scene.fogMode = Scene.FOGMODE_EXP2;
      scene.fogDensity = map.fogDensity;
    } else {
      scene.clearColor = new Color4(0.1, 0.12, 0.18, 1);
    }
    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.5;
    const dir = new DirectionalLight("dir", new Vector3(-0.4, -1, -0.3), scene);
    dir.intensity = 1.0;
    this.sun = dir;
    if (map) buildMap(scene, map);
  }

  private setupCamera() {
    const cam = new UniversalCamera("cam", new Vector3(0, PLAYER.eyeHeight, 0), this.scene);
    cam.minZ = 0.06;
    this.cam = cam;
    this.scene.activeCamera = cam;
  }

  private buildWeapons() {
    const vm: ViewModel = { meshes: [], flash: [] };
    const rifle = this.makeGun(0.09, 0.09, 0.55, 0.28, -0.26, 0.42, 0.72, "gunmat");
    const pistol = this.makeGun(0.07, 0.1, 0.3, 0.26, -0.24, 0.38, 0.56, "pistolmat");
    vm.meshes.push(rifle.mesh, pistol.mesh);
    vm.flash.push(rifle.flash, pistol.flash);
    (this as any).viewModel = vm;
    this.refreshViewmodel(0);
  }

  private makeGun(w: number, h: number, d: number, px: number, py: number, pz: number, tipZ: number, matName: string) {
    const gun = MeshBuilder.CreateBox(`weapon_${matName}`, { width: w, height: h, depth: d }, this.scene);
    const mat = new PBRMaterial(matName, this.scene);
    mat.albedoColor = matName === "pistolmat" ? new Color3(0.32, 0.3, 0.28) : new Color3(0.17, 0.19, 0.23);
    mat.metallic = 0.5;
    mat.roughness = 0.35;
    gun.material = mat;
    gun.parent = this.cam;
    gun.position.set(px, py, pz);

    const flash = MeshBuilder.CreateSphere(`flash_${matName}`, { diameter: 0.14 }, this.scene);
    const fmat = new PBRMaterial(`flashmat_${matName}`, this.scene);
    fmat.albedoColor = new Color3(1, 0.82, 0.35);
    fmat.emissiveColor = new Color3(1, 0.78, 0.3);
    flash.material = fmat;
    flash.parent = this.cam;
    flash.position.set(px, py, tipZ);
    flash.setEnabled(false);
    return { mesh: gun, flash };
  }

  private refreshViewmodel(w: number) {
    const vm = (this as any).viewModel as ViewModel;
    if (!vm) return;
    vm.meshes.forEach((m, i) => m.setEnabled(i === w));
  }

  private muzzle() {
    const vm = (this as any).viewModel as ViewModel | undefined;
    if (!vm || !this.settings.effects) return;
    const f = vm.flash[this.hotWeapon];
    if (!f) return;
    f.setEnabled(true);
    setTimeout(() => f.setEnabled(false), 40);
  }

  // ---- input ----

  private setupInput() {
    window.addEventListener("keydown", this.onKey(true));
    window.addEventListener("keyup", this.onKey(false));
    window.addEventListener("mousedown", (e) => {
      if (e.button === 0 && this.myAlive && document.pointerLockElement) this.msec = performance.now();
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.msec = 0;
    });
    document.addEventListener("pointerlockchange", () => {
      if (!document.pointerLockElement) this.msec = 0;
    });
    document.addEventListener("mousemove", (e) => {
      if (!document.pointerLockElement || this.paused) return;
      const s = this.settings;
      this.yaw += e.movementX * 0.0025 * s.mouseSens;
      this.pitch -= e.movementY * 0.0025 * s.mouseSensY * (s.invertY ? -1 : 1);
      this.clampPitch();
    });
    this.engine.getRenderingCanvas()?.addEventListener("click", () => {
      if (!document.pointerLockElement && !this.paused) this.requestPointerLock();
    });
  }

  private clampedPitch() {
    return Math.min(1.45, Math.max(-1.45, this.pitch));
  }
  private clampPitch() {
    this.pitch = this.clampedPitch();
  }

  private bind(k: BindingId): string | undefined {
    return this.settings.bindings[k];
  }

  private boundKeys(): string[] {
    return Object.values(this.settings.bindings);
  }

  private onKey(down: boolean) {
    return (e: KeyboardEvent) => {
      const k = e.code;
      if (down && k === "Escape") {
        if (!this.paused) e.preventDefault();
        this.togglePause();
        return;
      }
      if (this.paused) return;
      if (this.boundKeys().includes(k)) e.preventDefault();

      if (down && k === this.bind("jump") && this.myAlive) {
        this.jumpUntil = performance.now() + 90;
        audio.play("jump");
      }
      if (k === this.bind("reload")) {
        if (down) {
          audio.play("reload");
          this.beginLocalReload();
        }
      }
      if (down && k === this.bind("weapon1")) this.sendSwitch(0);
      else if (down && k === this.bind("weapon2")) this.sendSwitch(1);

      if (down) this.keys.add(k);
      else this.keys.delete(k);
    };
  }

  private beginLocalReload() {
    const key = WEAPON_KEYS[this.hotWeapon];
    if (typeof key !== "string") return;
    const dur = WEAPONS[key].reloadMs;
    this.reloadUntil = performance.now() + dur;
    this.reloadDur = dur;
  }

  private togglePause() {
    if (this.room.state?.state !== "playing") return;
    this.paused = !this.paused;
    if (this.paused) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.msec = 0;
      this.showPauseMenu();
    } else {
      this.hidePauseMenu();
      this.requestPointerLock();
    }
  }

  private showPauseMenu() {
    if (!this.pauseMenu) return;
    this.pauseMenu.classList.remove("hidden");
  }
  private hidePauseMenu() {
    this.pauseMenu?.classList.add("hidden");
  }

  // ---- per-frame game logic ----

  private has(b: BindingId): boolean {
    const code = this.bind(b);
    return !!code && this.keys.has(code);
  }

  private pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected && p.mapping === "standard") pad = p;
    this.ctl.active = !!pad;
    return pad;
  }

  private inputState(dt: number, now: number): { fx: number; fz: number; fire: boolean; sprint: boolean; crouch: boolean; jump: boolean } {
    const pad = this.pollGamepad();
    let fx = (this.has("right") ? 1 : 0) - (this.has("left") ? 1 : 0);
    let fz = (this.has("forward") ? 1 : 0) - (this.has("back") ? 1 : 0);

    const s = this.settings;
    if (pad) {
      const dead = 0.22;
      const ax = Math.abs(pad.axes[0] ?? 0) > dead ? pad.axes[0] : 0;
      const ay = Math.abs(pad.axes[1] ?? 0) > dead ? pad.axes[1] : 0;
      const rx = Math.abs(pad.axes[2] ?? 0) > dead ? pad.axes[2] : 0;
      const ry = Math.abs(pad.axes[3] ?? 0) > dead ? pad.axes[3] : 0;
      if (ax !== 0 || ay !== 0) {
        fx = ax;
        fz = -ay;
      }
      if (rx !== 0 || ry !== 0) {
        this.yaw += rx * s.controllerSens * dt;
        this.pitch -= ry * s.controllerSens * dt * (s.invertY ? -1 : 1);
        this.clampPitch();
      }
      const deadzone2 = (v: number | undefined) => (v && v > 0.5 ? v : 0);
      const fireHeld = deadzone2(pad.buttons[7]?.value) > 0;
      this.ctl.firePrev = this.ctl.fire;
      this.ctl.fire = fireHeld;
      // rising edges
      const rRel = !!(pad.buttons[3]?.pressed);
      const rSwap = !!(pad.buttons[5]?.pressed);
      this.ctl.reloadEdge = rRel && !this.ctl.reloadPrev;
      this.ctl.swapEdge = rSwap && !this.ctl.swapPrev;
      this.ctl.reloadPrev = rRel;
      this.ctl.swapPrev = rSwap;
      if (this.ctl.reloadEdge) {
        audio.play("reload");
        this.beginLocalReload();
        this.sendReload();
      }
      if (this.ctl.swapEdge) {
        audio.play("switch");
        this.sendSwitch((this.hotWeapon + 1) % WEAPON_KEYS.length);
      }
      // buttons as held movement/state
      const jumpHeld = deadzone2(pad.buttons[0]?.value) > 0;
      const sprintHeld = !!(pad.buttons[1]?.pressed);
      const crouchHeld = !!(pad.buttons[4]?.pressed);
      return { fx, fz, fire: fireHeld, sprint: sprintHeld || this.has("sprint"), crouch: crouchHeld || this.has("crouch"), jump: this.jumpUntil > now || (jumpHeld && this.myAlive) };
    }

    return {
      fx,
      fz,
      fire: false,
      sprint: this.has("sprint"),
      crouch: this.has("crouch"),
      jump: this.jumpUntil > now,
    };
  }

  private tick(dt: number, now: number) {
    if (!this.paused) {
      this.pendingInput = this.inputState(dt, now);
      const me = this.room.state?.players.get(this.myUid);
      if (me) {
        this.reconcile(me, now);
        if (this.myAlive && this.pendingInput) {
          applyMovement(this.move, {
            yaw: this.yaw,
            fx: this.pendingInput.fx,
            fz: this.pendingInput.fz,
            jump: this.pendingInput.jump,
            sprint: this.pendingInput.sprint,
            crouch: this.pendingInput.crouch,
            dt,
          });
          this.collide();
        }
      }
      this.sendInput(now);
    }
    this.updateCamera();
    this.updateRemoteMeshes(dt);
    this.updateHud(now);
    this.updateAimAssist();
  }

  private updateAimAssist() {
    if (!this.settings.aimAssist || !this.myAlive || !this.ctl.fire) return;
    const eyeY = this.move.y + (this.move.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight);
    const my = { x: this.move.x, y: eyeY, z: this.move.z };
    let bestErr = 0.14;
    let best = { yawErr: 0, pitchErr: 0 };
    for (const r of this.remote.values()) {
      if (!r.alive) continue;
      const t = r.target;
      const dx = t.x - my.x;
      const dz = t.z - my.z;
      const dy = t.y + 1.5 - my.y;
      const dist = Math.max(0.01, Math.hypot(dx, dz));
      const wantYaw = Math.atan2(dx, dz);
      const wantPitch = Math.atan2(dy, dist);
      const yawErr = Math.abs(wrapAngle(wantYaw - this.yaw));
      const pitchErr = Math.abs(wrapAngle(wantPitch - this.pitch));
      const err = yawErr + pitchErr;
      if (err < bestErr) {
        bestErr = err;
        best = { yawErr: wrapAngle(wantYaw - this.yaw), pitchErr: wantPitch - this.pitch };
      }
    }
    if (bestErr < 0.14) {
      const k = 0.35;
      this.yaw += best.yawErr * k;
      this.pitch += best.pitchErr * k;
      this.clampPitch();
    }
  }

  private collide() {
    const r = PLAYER.radius;
    let { x, z } = this.move;
    for (const b of this.colliders) {
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = (r - d) / 1;
        x += (dx / d) * push;
        z += (dz / d) * push;
      } else {
        const left = x - b.min.x;
        const right = b.max.x - x;
        const top = z - b.min.z;
        const bottom = b.max.z - z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x -= r;
        else if (m === right) x += r;
        else if (m === top) z -= r;
        else z += r;
      }
    }
    x = Math.max(this.bounds.minX + r, Math.min(this.bounds.maxX - r, x));
    z = Math.max(this.bounds.minZ + r, Math.min(this.bounds.maxZ - r, z));
    this.move.x = x;
    this.move.z = z;
  }

  private reconcile(me: PlayerState, now: number) {
    const was = this.myAlive;
    this.myAlive = me.alive;
    if (!was && me.alive) {
      this.move.x = me.x;
      this.move.y = me.y;
      this.move.z = me.z;
      hideRespawning();
      hideRespawnOverlay();
      return;
    }
    if (was && !me.alive) {
      showRespawnOverlay();
      audio.play("damage");
    }
    if (this.myAlive) {
      const dx = me.x - this.move.x;
      const dz = me.z - this.move.z;
      if (Math.hypot(dx, dz) > 2.5) {
        this.move.x = me.x;
        this.move.z = me.z;
      } else {
        const k = Math.min(1, dtOf(now));
        this.move.x += dx * k;
        this.move.z += dz * k;
      }
      this.move.crouching = me.crouching;
    }
  }

  private sendInput(now: number) {
    if (now - this.lastSent < 33) return;
    this.lastSent = now;
    if (this.paused) return;
    const canPlay = this.room.state.state === "playing" && this.myAlive;
    const st = this.pendingInput ?? this.idleInputState();
    const fire = canPlay && (st.fire || (document.pointerLockElement !== null && this.msec > 0));
    this.room.send(MSG.INPUT, {
      seq: this.seq++,
      yaw: this.yaw,
      pitch: this.pitch,
      fx: st.fx,
      fz: st.fz,
      buttons: {
        fire,
        jump: st.jump,
        sprint: st.sprint,
        crouch: st.crouch,
      },
    });
    if (fire) {
      this.muzzle();
      const key = WEAPON_KEYS[this.hotWeapon];
      const interval = typeof key === "string" ? WEAPONS[key].fireIntervalMs : 120;
      if (now - this.lastFireSoundAt >= interval) {
        this.lastFireSoundAt = now;
        audio.play("fire");
      }
    }
  }

  private sendReload() {
    this.room.send(MSG.RELOAD, {});
  }

  private idleInputState() {
    return { fx: 0, fz: 0, fire: false, sprint: false, crouch: false, jump: false };
  }
  private sendSwitch(slot: number) {
    audio.play("switch");
    this.room.send(MSG.SWITCH, slot);
  }

  private updateCamera() {
    const eye = this.move.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    const px = this.move.x;
    const py = Math.max(0, this.move.y) + eye;
    const pz = this.move.z;
    this.cam.position.set(px, py, pz);
    const cp = Math.cos(this.pitch);
    const tx = Math.sin(this.yaw) * cp * 8 + px;
    const ty = Math.sin(this.pitch) * 8 + py;
    const tz = Math.cos(this.yaw) * cp * 8 + pz;
    this.cam.setTarget(new Vector3(tx, ty, tz));
  }

  // ---- networking / schema ----

  private setupWiring() {
    const players = getMapCallbacks<GameRoomState, "players", PlayerState>(this.room, "players");
    players.onAdd((ps) => {
      getInstanceCallbacks(this.room, ps).onChange(() => this.onPlayerChange(ps));
      this.onPlayerAdd(ps);
    });
    players.onRemove((ps, key) => this.onPlayerRemove(key ?? ps.id));

    this.room.onMessage(MSG.HIT, () => {
      hitMarker();
      audio.play("hit");
    });
    this.room.onMessage(MSG.DAMAGED, () => {
      damageFlash();
      audio.play("damage");
    });
    this.room.onMessage(MSG.SPAWN, () => {
      hideRespawnOverlay();
      audio.play("spawn");
    });
    getArrayCallbacks<GameRoomState, "killFeed", KillFeedItem>(this.room, "killFeed").onAdd((item) => {
      pushKill(item.killerName, item.victimName, item.weapon, item.headshot);
      if (item.victimId === this.myUid) showRespawnOverlay();
      if (item.killerId === this.myUid) audio.play("kill");
    });
    this.room.onMessage(MSG.MATCH_END, (msg: MatchEndMessage) => this.opts.onEnd(msg));

    setupHud();
    this.hudDone = true;
  }

  private onPlayerAdd(ps: PlayerState) {
    if (ps.id === this.myUid) {
      this.myAlive = ps.alive;
      this.move.x = ps.x;
      this.move.z = ps.z;
      return;
    }
    this.addRemote(ps);
  }

  private onPlayerChange(ps: PlayerState) {
    if (ps.id === this.myUid) {
      this.myAlive = ps.alive;
      if (ps.weapon !== this.hotWeapon) {
        this.hotWeapon = ps.weapon;
        this.refreshViewmodel(this.hotWeapon);
      }
      if (ps.reloading) {
        if (this.reloadUntil < performance.now()) this.beginLocalReloadFor(ps.weapon);
      } else {
        this.reloadUntil = 0;
      }
      return;
    }
    const cur = this.remote.get(ps.id);
    if (cur) {
      cur.target.set(ps.x, ps.y, ps.z);
      cur.alive = ps.alive;
      cur.root.setEnabled(ps.alive);
    } else {
      this.addRemote(ps);
    }
  }

  private beginLocalReloadFor(slot: number) {
    const key = WEAPON_KEYS[slot];
    if (typeof key !== "string") return;
    this.reloadUntil = performance.now() + WEAPONS[key].reloadMs;
    this.reloadDur = WEAPONS[key].reloadMs;
  }

  private onPlayerRemove(key: string) {
    const cur = this.remote.get(key);
    if (cur) {
      cur.root.dispose();
      this.remote.delete(key);
    }
  }

  private addRemote(ps: PlayerState) {
    const scene = this.scene;
    const teamA = ps.team === 0;
    const bodyColor = teamA ? new Color3(0.25, 0.48, 0.95) : new Color3(0.95, 0.31, 0.27);
    const root = new Mesh(`p_${ps.id}`, scene);

    const bodyMat = new PBRMaterial(`mb_${ps.id}`, scene);
    bodyMat.albedoColor = bodyColor;
    bodyMat.roughness = 0.55;
    const headMat = new PBRMaterial(`mh_${ps.id}`, scene);
    headMat.albedoColor = bodyColor;
    headMat.roughness = 0.45;
    const gunMat = new PBRMaterial(`mg_${ps.id}`, scene);
    gunMat.albedoColor = new Color3(0.2, 0.22, 0.24);

    const body = MeshBuilder.CreateCylinder(`b_${ps.id}`, { height: 1.35, diameter: 0.7, tessellation: 14 }, scene);
    const head = MeshBuilder.CreateBox(`h_${ps.id}`, { width: 0.32, height: 0.32, depth: 0.32 }, scene);
    const gun = MeshBuilder.CreateBox(`g_${ps.id}`, { width: 0.08, height: 0.08, depth: 0.5 }, scene);
    body.material = bodyMat;
    head.material = headMat;
    gun.material = gunMat;

    body.parent = root;
    head.parent = root;
    gun.parent = root;
    body.position.y = 0.7;
    head.position.y = 1.62;
    gun.position.set(0.3, 1.2, 0.3);

    const entry: RemoteEntry = { root, target: new Vector3(ps.x, ps.y, ps.z), alive: ps.alive };
    root.position.copyFrom(entry.target);
    root.rotation.y = ps.yaw;
    root.setEnabled(ps.alive);
    if (this.shadowGen) {
      this.shadowGen.addShadowCaster(root);
      root.receiveShadows = true;
    }
    this.remote.set(ps.id, entry);
  }

  private updateRemoteMeshes(dt: number) {
    for (const r of this.remote.values()) {
      const target = r.target;
      const k = Math.min(1, dt * 10);
      r.root.position.x += (target.x - r.root.position.x) * k;
      r.root.position.y += (target.y - r.root.position.y) * k;
      r.root.position.z += (target.z - r.root.position.z) * k;
    }
  }

  private updateHud(now: number) {
    if (!this.hudDone) return;
    const me = this.room.state?.players.get(this.myUid);
    const s = this.room.state;
    if (!me || !s) return;
    setHealth(this.myAlive ? me.health : 0);
    const weaponName = typeof WEAPON_KEYS[me.weapon] === "string" ? WEAPONS[WEAPON_KEYS[me.weapon]].name : "";
    setWeapon(me.weapon, weaponName);
    const reloading = me.reloading || this.reloadUntil > now;
    setAmmo(this.myAlive ? me.ammo : 0, me.reserve, reloading);
    if (this.reloadBarEl) {
      const pct = reloading && this.reloadDur > 0 ? Math.min(1, (now - (this.reloadUntil - this.reloadDur)) / this.reloadDur) : 1;
      this.reloadBarEl.style.width = `${Math.round(pct * 100)}%`;
      this.reloadBarEl.parentElement?.classList.toggle("hidden", !reloading);
    }
    if (this.myAlive && me.ammo === 0 && !reloading && s.state === "playing" && now > this.emptyUntil) {
      this.emptyUntil = now;
      flashEmpty();
      audio.play("empty");
    }
    setScores(s.scoreA, s.scoreB, timeLeft(s.timeLeft));
  }
}

// ---- HUD helpers ----

function timeLeft(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function hitMarker() {
  const el = document.getElementById("hitmarker");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 90);
}
function damageFlash() {
  const el = document.getElementById("damage-vignette");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 140);
}
function pushKill(killer: string, victim: string, weapon: string, headshot: boolean) {
  const feed = document.getElementById("killfeed");
  if (!feed) return;
  const row = document.createElement("div");
  row.className = "kf";
  row.textContent = `${killer} ${headshot ? "HS" : "✕"} ${victim} [${weapon}]`;
  feed.appendChild(row);
  setTimeout(() => row.remove(), 5000);
}
function setHealth(h: number) {
  const el = document.getElementById("health");
  if (el) el.innerHTML = `<span class="label">HEALTH</span>${Math.ceil(Math.max(0, h))}`;
}
function setAmmo(ammo: number, reserve: number, reloading: boolean) {
  const el = document.getElementById("ammo");
  if (el) el.innerHTML = `<span class="label">AMMO</span>${reloading ? "RELOADING" : `${ammo} / ${reserve}`}`;
}
function setWeapon(slot: number, name: string) {
  const el = document.getElementById("weapon-name");
  if (el) el.textContent = name;
  document.querySelectorAll<HTMLElement>("#weapon-slots .slot").forEach((s) => s.classList.toggle("active", Number(s.dataset.slot) === slot));
}
function setScores(a: number, b: number, t: string) {
  const el = document.getElementById("score-bar");
  if (!el) return;
  el.innerHTML = `<span class="scoreA">${a}</span><span class="timer">${t} · TDM</span><span class="scoreB">${b}</span>`;
}
function flashEmpty() {
  const el = document.getElementById("empty-flash");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 600);
}
export function showRespawnOverlay() {
  const el = document.getElementById("respawn-overlay");
  if (el) el.classList.add("show");
}
function hideRespawnOverlay() {
  const el = document.getElementById("respawn-overlay");
  if (el) el.classList.remove("show");
}
function hideRespawning() {
  const el = document.getElementById("respawn-overlay");
  if (el) el.classList.remove("show");
}

function dtOf(now: number) {
  void now;
  return 1 / 30;
}

function setupHud() {
  const hud = document.getElementById("hud");
  if (!hud || hud.dataset.ready) return;
  hud.dataset.ready = "1";
  hud.innerHTML = `
    <div id="crosshair"></div>
    <div id="health"></div>
    <div id="ammo"></div>
    <div id="score-bar"></div>
    <div id="killfeed"></div>
    <div id="damage-vignette"></div>
    <div id="hitmarker"><svg viewBox="0 0 18 18"><path d="M9 1v6M9 11v6M1 9h6M11 9h6"/></svg></div>
    <div id="weapon-slot">
      <div id="weapon-name"></div>
      <div id="weapon-slots">
        <span class="slot" data-slot="0">1</span>
        <span class="slot" data-slot="1">2</span>
      </div>
    </div>
    <div id="reload-wrap" class="hidden"><div id="reload-bar"></div></div>
    <div id="empty-flash">EMPTY</div>
    <div id="respawn-overlay">YOU DIED</div>
    <div id="pause-menu" class="hidden">
      <div class="modal">
        <h2>PAUSED</h2>
        <div class="pause-actions">
          <button class="btn btn-primary" id="pause-resume">RESUME</button>
          <button class="btn btn-secondary" id="pause-settings">SETTINGS</button>
          <button class="btn btn-danger" id="pause-leave">LEAVE MATCH</button>
        </div>
      </div>
    </div>`;

  const menu = document.getElementById("pause-menu");
  const btn = (id: string) => document.getElementById(id);
  btn("pause-resume")?.addEventListener("click", () => window.__gameApp?.resumeFromPause());
  btn("pause-settings")?.addEventListener("click", () => openSettingsPanel({ onClose: () => window.__gameApp?.resumeFromPause() }));
  btn("pause-leave")?.addEventListener("click", () => window.__gameApp?.optQuit());
  menu?.addEventListener("mousedown", (e) => e.stopPropagation());
}

declare global {
  interface Window {
    __gameApp?: GameApp;
  }
}