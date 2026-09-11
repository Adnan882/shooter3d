import * as THREE from "three";
import * as CANNON from "cannon-es";
import { io } from "socket.io-client";
import { PhysWorld } from "./physics.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* =====================================================================
   0. MODEL ASSETS  (your uploaded GLBs → tactical/public/models)
   - character.glb : rigged animated humanoid (1.7 m, origin at feet)
   - rifle.glb     : primary weapon prop (~1.0 m along X)
   - sidearm.glb   : secondary weapon prop (~1.0 m along X)
   - blade.glb     : knife ability prop (1.19 m thin blade along Y)
===================================================================== */
const MODEL_PATHS = {
  character: "/models/character.glb",
  rifle: "/models/rifle.glb",
  sidearm: "/models/sidearm.glb",
  blade: "/models/blade.glb",
};

// Tune these if a prop is angled wrong in a character's hand or in viewmodel.
const WEAPON_ANCHOR_POS = { rifle: [0.06, -0.05, 0.02], sidearm: [0.05, -0.06, 0.04], blade: [0.1, -0.12, 0.04] };
const WEAPON_ANCHOR_ROT = { rifle: [0, Math.PI / 2, 0], sidearm: [0, Math.PI / 2, Math.PI / 3], blade: [Math.PI / 2, 0, 0] };
const VIEW_POS = { rifle: [0.3, -0.28, -0.52], sidearm: [0.24, -0.26, -0.44], blade: [0.22, -0.3, -0.5] };
const VIEW_ROT = { rifle: [0, 0, 0], sidearm: [-0.1, 0, 0], blade: [-0.4, 0, 0] };
const CHAR_FACE_OFFSET = Math.PI; // models face +Z; game forward is -Z → flip 180°

const gltfLoader = new GLTFLoader();
const assetCache = {};
function loadAsset(key) {
  if (!assetCache[key]) {
    assetCache[key] = new Promise((resolve, reject) =>
      gltfLoader.load(MODEL_PATHS[key], (gltf) => resolve({ scene: gltf.scene, anims: gltf.animations ?? [] }), undefined, (e) => reject(e)),
    );
  }
  return assetCache[key];
}

let characterReady = false;
const characterPromise = loadAsset("character");
characterPromise.then(() => (characterReady = true)).catch(() => console.warn("character.glb failed to load; falling back to primitives"));

const mixers = new Set();          // { mixer, group } — per-cloned character animator
const humanoidsAwaitingModel = new Set();

function animTimeScale(a) {
  return a === "dead" ? 0 : a === "idle" ? 0.35 : a === "crouch" ? 0.7 : a === "jump" ? 1 : a === "sprint" ? 1.5 : 1;
}

/* =====================================================================
   1. CONFIG
===================================================================== */
const ARENA = { w: 46, d: 34, wallH: 4 };          // playable arena (x, z)
const FOV = 90;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.1;
const BODY_HALF = 0.45;
const WALK = 4.2, SPRINT = 6.2, CROUCH = 2.3, JUMP = 7.0, AIR_PENALTY = 0.5;
const INTERP_DELAY = 0.1;
const SPAWN_A = { x: -8, z: 0, yaw: 0 };
const SPAWN_B = { x: 8, z: 0, yaw: Math.PI };

const WEAPONS = [
  { id: "vx7", name: "VX-7 RIFLE", damage: 25, rateMs: 115, auto: true, clipMax: 30, reserveMax: 90, reserve: 90, range: 120 },
  { id: "m9", name: "M9 SIDEARM", damage: 32, rateMs: 240, auto: false, clipMax: 12, reserveMax: 48, reserve: 48, range: 80 },
];

const ABILITIES = [
  { key: "KeyQ", id: "frag", cdMs: 8000 },
  { key: "KeyE", id: "smoke", cdMs: 15000 },
  { key: "KeyC", id: "stim", cdMs: 20000 },
  { key: "KeyX", id: "knife", cdMs: 1200 },
];

const ITEMS = {
  medkit: { id: "medkit", name: "Medkit", kind: "med", heal: 25 },
  ammo: { id: "ammo", name: "Ammo Pack", kind: "ammo", add: 60 },
  vest: { id: "vest", name: "Armor Vest", kind: "armor", max: 50 },
  rifle: { id: "vx7", name: "VX-7 Rifle", kind: "weapon", weaponIdx: 0 },
  pistol: { id: "m9", name: "M9 Sidearm", kind: "weapon", weaponIdx: 1 },
};

/* =====================================================================
   2. DOM / SOCKET
===================================================================== */
const $ = (sel) => document.querySelector(sel);
const canvas = $("#game");
const joiningEl = $("#connecting");

let socket = null;
let me = null;          // { id, name, team }
let peerChannels = new Map();   // peerId -> RTCDataChannel
let peers = new Map();          // peerId -> { pc, connected }

window.__game = {
  get remoteCount() { return remotes.size; },
  get peerCount() { return peers.size; },
  get connectedPeers() { let n = 0; for (const e of peers.values()) if (e.connected) n++; return n; },
  remotePositions: () => [...remotes.values()].map((r) => [+r.group.position.x, +r.group.position.z]),
  get characterBones() { let n = 0; scene.traverse((o) => { if (o.name === "RightHand") n++; }); return n; },
};

/* =====================================================================
   3. RENDERER / SCENE / CAMERA
===================================================================== */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1320);
scene.fog = new THREE.FogExp2(0x0a1320, 0.02);

const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 300);
camera.rotation.order = "YXZ";

scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x3a4a5c, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
sun.position.set(20, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 120;
scene.add(sun);

/* =====================================================================
   4. ARENA GEOMETRY + PHYSICS
===================================================================== */
const world = new PhysWorld();
const staticBodies = [];   // raycast cover bodies

function buildArena() {
  const hw = ARENA.w / 2, hd = ARENA.d / 2, th = ARENA.wallH, t = 0.8;
  const mat = new THREE.MeshStandardMaterial({ color: 0x24324a, roughness: 0.9 });
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2639, roughness: 1 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.w, ARENA.d), groundMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wall = (x, z, w, d, h) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const b = world.addStaticBox(x, h / 2, z, w / 2, h / 2, d / 2, "wall");
    staticBodies.push(b);
  };
  wall(0, -hd - t / 2, ARENA.w + t * 2, t, th);
  wall(0, hd + t / 2, ARENA.w + t * 2, t, th);
  wall(-hw - t / 2, 0, t, ARENA.d, th);
  wall(hw + t / 2, 0, t, ARENA.d, th);

  // interior cover crates
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.85 });
  const crates = [
    { x: -6, z: -7, s: 2.4 }, { x: -6, z: 7, s: 2.4 },
    { x: 6, z: -7, s: 2.4 }, { x: 6, z: 7, s: 2.4 },
    { x: 0, z: 0, s: 3.2, h: 1.6 },
  ];
  for (const c of crates) {
    const h = c.h ?? 2.2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(c.s, h, c.s), crateMat);
    m.position.set(c.x, h / 2, c.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const b = world.addStaticBox(c.x, h / 2, c.z, c.s / 2, h / 2, c.s / 2, "crate");
    staticBodies.push(b);
  }
}
buildArena();
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

/* =====================================================================
   5. LOCAL PLAYER STATE
===================================================================== */
let self = null;   // player instance below
class Player {
  constructor(name, team, spawn) {
    this.id = me.id;
    this.name = name;
    this.team = team;
    this.spawn = spawn;
    this.body = world.createPlayer({ x: spawn.x, y: BODY_HALF, z: spawn.z });
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.armor = 0;
    this.armorMax = 0;
    this.alive = true;
    this.respawnAt = 0;
    this.kills = 0;
    this.weaponIdx = 0;
    this.loadout = [
      { ...WEAPONS[0], clip: WEAPONS[0].clipMax },
      { ...WEAPONS[1], clip: WEAPONS[1].clipMax },
    ];
    this.bag = new Array(20).fill(null); // 5x4 backpack
    this.abilityCd = [0, 0, 0, 0];
    this.stimHp = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.muzzle = 0;
    this.fireCooldown = 0;
    this.crouching = false;
    this.readies = true;
    this.anim = "idle";
    this.eyeOffset = STAND_EYE - BODY_HALF;

    this.group = makeHumanoid(this.team);
    scene.add(this.group);
    camera.position.set(spawn.x, BODY_HALF + this.eyeOffset, spawn.z);
    this.group.visible = false; // first-person: hide own body
  }
}

const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

function makeHumanoid(team) {
  const g = new THREE.Group();
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.8, 10), hitMaterial);
  hit.position.y = 0.9;
  g.add(hit);
  g.userData.team = team;
  g.userData.hitMeshes = [hit];
  g.userData.model = null;
  g.userData.mixerEntry = null;
  g.userData.handBone = null;
  g.userData.weaponHolder = null;
  g.userData.weaponIdx = -1;
  g.userData.anim = "idle";
  humanoidsAwaitingModel.add(g);
  maybePatchModel(g);
  return g;
}

/** Swap the primitive placeholder for the real rigged character once loaded. */
function maybePatchModel(g) {
  if (!characterReady || !characterAssetReady || g.userData.model) return;
  const sceneClone = characterAssetReady.scene.clone(true);
  tintToTeam(sceneClone, g.userData.team);
  sceneClone.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = o.isSkinnedMesh;
  });
  sceneClone.rotation.y = CHAR_FACE_OFFSET;
  g.add(sceneClone);
  g.userData.model = sceneClone;
  g.userData.handBone = sceneClone.getObjectByName("RightHand") ?? null;

  if (characterAssetReady.anims.length) {
    const mixer = new THREE.AnimationMixer(sceneClone);
    mixer.clipAction(characterAssetReady.anims[0]).play();
    const entry = { mixer, group: g };
    g.userData.mixerEntry = entry;
    mixers.add(entry);
  }
  humanoidsAwaitingModel.delete(g);
}

let characterAssetReady = null;
characterPromise.then((asset) => {
  characterAssetReady = asset;
  for (const g of [...humanoidsAwaitingModel]) maybePatchModel(g);
}).catch(() => {});

function syncWeaponInHand(g, weaponIdx) {
  if (!g || !g.userData.handBone) return;
  if (g.userData.weaponIdx === weaponIdx && g.userData.weaponHolder) return;
  g.userData.weaponIdx = weaponIdx;
  if (g.userData.weaponHolder) {
    g.userData.weaponHolder.parent?.remove(g.userData.weaponHolder);
    g.userData.weaponHolder = null;
  }
  const key = weaponIdx === 0 ? "rifle" : "sidearm";
  loadAsset(key).then((asset) => {
    if (!g.userData.handBone || g.userData.weaponIdx !== weaponIdx) return;
    const holder = new THREE.Group();
    holder.add(asset.scene.clone(true));
    holder.position.set(...WEAPON_ANCHOR_POS[key]);
    holder.rotation.set(...WEAPON_ANCHOR_ROT[key]);
    g.userData.handBone.add(holder);
    g.userData.weaponHolder = holder;
  });
}

function teamRing(team) {
  const col = team === 0 ? 0x3b82f6 : 0xef4444;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: col }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  return ring;
}

function nameLabel(name) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = "#fff";
  ctx.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.1, 0.28, 1);
  sprite.position.y = 2.1;
  return sprite;
}

function tintToTeam(scene, team) {
  if (team !== 1) return;
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material.slice() : [o.material];
    const clones = mats.map((mat) => {
      const c = mat.clone();
      if (c.color) c.color = c.color.clone().lerp(new THREE.Color(0xff4444), 0.55);
      if (c.emissive) c.emissive.setHex(0x2a0000);
      return c;
    });
    o.material = Array.isArray(o.material) ? clones : clones[0];
  });
}

/* =====================================================================
   6. REMOTE PLAYER STORE (interpolation)
===================================================================== */
const remotes = new Map();   // id -> { group, hp, history: [], name }
const enemyHitMeshes = [];

function makeEnemyHitMeshes(group) {
  return group.userData.hitMeshes;
}

function addRemote(pl) {
  if (remotes.has(pl.id) || (me && pl.id === me.id)) return;
  const r = {
    id: pl.id,
    name: pl.name,
    team: pl.team,
    group: makeHumanoid(pl.team),
    hp: pl.hp ?? 100,
    history: [],
    last: null,
  };
  r.group.position.set(pl.x ?? 0, 0, pl.z ?? 0);
  r.group.add(teamRing(pl.team));
  if (pl.id !== me?.id) r.group.add(nameLabel(pl.name));
  scene.add(r.group);
  for (const m of makeEnemyHitMeshes(r.group)) {
    m.userData.remoteId = pl.id;
    enemyHitMeshes.push(m);
  }
  remotes.set(pl.id, r);
  return r;
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.group);
  if (r.group.userData.mixerEntry) mixers.delete(r.group.userData.mixerEntry);
  humanoidsAwaitingModel.delete(r.group);
  r.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
  remotes.delete(id);
  for (let i = enemyHitMeshes.length - 1; i >= 0; i--) {
    if (enemyHitMeshes[i].userData.remoteId === id) enemyHitMeshes.splice(i, 1);
  }
}

function pushRemoteState(id, pkt) {
  const r = remotes.get(id);
  if (!r) return;
  if (r.history.length && r.history[r.history.length - 1].t > pkt.t) return; // out of order
  r.history.push({
    t: pkt.t,
    x: pkt.x, y: pkt.y, z: pkt.z,
    qx: pkt.qx, qy: pkt.qy, qz: pkt.qz, qw: pkt.qw,
    hp: pkt.hp, alive: pkt.alive !== false, w: pkt.w, anim: pkt.anim ?? "idle",
  });
  if (r.history.length > 30) r.history.shift();
  r.hp = pkt.hp;
  r.group.visible = pkt.alive !== false;
}

/* =====================================================================
   7. INPUT
===================================================================== */
const keys = new Set();
let mouseDown = false;
let locked = false;
let tabOpen = false;

function preventUI(e) {
  if (["Space", "Tab", "KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "Digit1", "Digit2"].includes(e.code)) e.preventDefault();
}

window.addEventListener("keydown", (e) => {
  preventUI(e);
  keys.add(e.code);
  if (e.code === "Tab") { e.preventDefault(); toggleInventory(); }
  if (!self || !locked || tabOpen) return;
  if (e.code === "KeyR") reload();
  if (e.code === "Digit1") switchWeapon(0);
  if (e.code === "Digit2") switchWeapon(1);
  for (let i = 0; i < ABILITIES.length; i++) {
    if (e.code === ABILITIES[i].key) useAbility(i);
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) mouseDown = false;
});
canvas.addEventListener("click", () => {
  if (!tabOpen) canvas.requestPointerLock();
});
document.addEventListener("mousemove", (e) => {
  if (!locked || tabOpen || !self) return;
  self.yaw -= e.movementX * 0.0023;
  self.pitch -= e.movementY * 0.0023;
  self.pitch = Math.max(-85 * Math.PI / 180, Math.min(85 * Math.PI / 180, self.pitch));
});
document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && locked && !tabOpen) {
    mouseDown = true;
    if (self && self.alive && !currentWeapon().auto) fire();
  }
});
document.addEventListener("mouseup", (e) => { if (e.button === 0) mouseDown = false; });

/* =====================================================================
   8. WEAPONS / GUNPLAY / ABILITIES
===================================================================== */
function currentWeapon() { return self.loadout[self.weaponIdx]; }

function switchWeapon(i) {
  if (!self || i < 0 || i > 1) return;
  self.weaponIdx = i;
  self.fireCooldown = Math.min(self.fireCooldown, 80);
  $("#wpn").textContent = currentWeapon().name.toUpperCase();
  updateAmmoHud();
  setViewmodel(self.weaponIdx === 0 ? "rifle" : "sidearm");
}

/** Camera-attached gun (first person). Assigned async once the GLB finishes. */
function setViewmodel(key, until = 0) {
  if (!camera) return;
  self.viewKey = key;
  self.viewUntil = until;
  const old = camera.getObjectByName("viewmodel");
  if (old) camera.remove(old);
  loadAsset(key).then((asset) => {
    if (!self || self.viewKey !== key || !camera) return;
    const holder = new THREE.Group();
    holder.name = "viewmodel";
    const model = asset.scene.clone(true);
    model.traverse((o) => { o.castShadow = false; });
    holder.add(model);
    holder.position.set(...VIEW_POS[key]);
    holder.rotation.set(...VIEW_ROT[key]);
    camera.add(holder);
  });
}

function reload() {
  const w = currentWeapon();
  if (w.clip >= w.clipMax || w.reserve <= 0 || self.reloading) return;
  self.reloading = true;
  self.reloadDoneAt = performance.now() + 1500;
}

function updateAmmoHud() {
  const w = currentWeapon();
  $("#clip").textContent = w.clip;
  $("#reserve").textContent = w.reserve;
}

function fire() {
  if (!self || !self.alive) return;
  const w = currentWeapon();
  if (self.reloading) return;
  if (performance.now() < self.fireCooldown) return;
  if (w.clip <= 0) { reload(); return; }
  const now = performance.now();
  self.fireCooldown = now + w.rateMs;
  w.clip--;
  updateAmmoHud();

  // recoil — upward + horizontal shake; decays while not firing
  self.recoilPitch += 0.008 + Math.random() * 0.004;
  self.recoilYaw += (Math.random() - 0.5) * 0.012;
  self.recoilPitch = Math.min(self.recoilPitch, 0.16);

  self.muzzle = now;
  triggerHurtIfHit(w);
}

const raycaster = new THREE.Raycaster();
function castShot(w) {
  const r = world.raycast(
    camera.getWorldPosition(new THREE.Vector3()),
    camera.getWorldDirection(new THREE.Vector3()).normalize(),
    w.range,
    self.body,
  );
  return r;
}

function triggerHurtIfHit(w) {
  const dir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const originV = camera.getWorldPosition(new THREE.Vector3());
  // does an enemy sit inside the shot beam (before world geometry)?
  const worldHit = castShot(w);
  raycaster.set(originV, dir);
  raycaster.far = worldHit ? Math.min(w.range, worldHit.distance) : w.range;
  const hits = raycaster.intersectObjects(enemyHitMeshes, false);
  if (hits.length < 1) return;
  const targetId = hits[0].object.userData.remoteId;
  if (!targetId) return;
  hitFlash();
  sendAction({ to: targetId, type: "hurt", amount: w.damage, by: me.id, weapon: currentWeapon().id });
}

// melee (X)
function doKnife() {
  setViewmodel("blade", performance.now() + 450);
  const dir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir);
  raycaster.far = 2.6;
  const hits = raycaster.intersectObjects(enemyHitMeshes, false);
  if (hits.length < 1) return;
  const targetId = hits[0].object.userData.remoteId;
  if (!targetId) return;
  hitFlash();
  sendAction({ to: targetId, type: "hurt", amount: 35, by: me.id, weapon: "knife" });
}

function useAbility(i) {
  if (!self || !self.alive || !locked) return;
  if (performance.now() < self.abilityCd[i]) return;
  self.abilityCd[i] = performance.now() + ABILITIES[i].cdMs;
  const id = ABILITIES[i].id;
  if (id === "frag") throwProjectile("frag");
  else if (id === "smoke") throwProjectile("smoke");
  else if (id === "stim") { self.stimHp = Math.min(self.maxHp - self.hp, 30); }
  else if (id === "knife") doKnife();
}

function throwProjectile(kind) {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const vel = {
    x: dir.x * 22 + self.body.velocity.x * 0.25,
    y: dir.y * 22 + 4,
    z: dir.z * 22 + self.body.velocity.z * 0.25,
  };
  const body = world.createProjectile({ x: origin.x, y: origin.y, z: origin.z }, vel);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(kind === "smoke" ? 0.22 : 0.16, 10, 8),
    new THREE.MeshStandardMaterial({ color: kind === "smoke" ? 0x9aa3b5 : 0x2a2f36, roughness: 0.5, emissive: kind === "smoke" ? 0x22303c : 0x000000, emissiveIntensity: 0.4 }),
  );
  scene.add(mesh);

  body.addEventListener("collide", (e) => {
    const contact = e.contact;
    const impact = {
      x: body.position.x,
      y: Math.max(0.05, body.position.y),
      z: body.position.z,
      vx: body.velocity.x, vy: body.velocity.y, vz: body.velocity.z,
    };
    world.removeBody(body);
    scene.remove(mesh);
    if (kind === "smoke") spawnSmoke(impact.x, 0, impact.z, self.team);
    else explode(impact);
  });

  // safety timeout
  setTimeout(() => {
    try { if (body.world) world.removeBody(body); } catch {}
    scene.remove(mesh);
  }, 6000);
}

const smokeVolumes = [];
function spawnSmoke(x, y, z, team, noBroadcast = false) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8f9ab0, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false });
  const cluster = new THREE.Group();
  const clouds = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), mat);
    s.position.set((Math.random() - 0.5) * 2.4, 0.3 + Math.random(), (Math.random() - 0.5) * 2.4);
    s.scale.set(0.1, 0.1, 0.1);
    cluster.add(s);
    clouds.push(s);
  }
  cluster.position.set(x, y, z);
  scene.add(cluster);
  const vol = { group: cluster, until: performance.now() + 15000, bornAt: performance.now() };
  smokeVolumes.push(vol);
  if (!noBroadcast) sendAction({ type: "smoke", x, y, z, team });
  setTimeout(() => {
    scene.remove(cluster);
    const i = smokeVolumes.indexOf(vol);
    if (i >= 0) smokeVolumes.splice(i, 1);
  }, 16000);
}

function explode(impact) {
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa437, transparent: true, opacity: 0.9 }),
  );
  boom.position.set(impact.x, impact.y, impact.z);
  scene.add(boom);
  setTimeout(() => scene.remove(boom), 450);

  // AOE damage to nearby remotes
  for (const r of remotes.values()) {
    if (!r.group.visible) continue;
    const d = Math.hypot(r.group.position.x - impact.x, r.group.position.z - impact.z);
    if (d < 5) {
      sendAction({ to: r.id, type: "hurt", amount: Math.round(55 * (1 - d / 5)), by: me.id, weapon: "frag" });
    }
  }
  // radial impulse / camera shake if close
  const dSelf = Math.hypot(self.body.position.x - impact.x, self.body.position.z - impact.z);
  if (dSelf < 6) self.recoilPitch += (6 - dSelf) / 6 * 0.1;
}

function applyDamage(amount, byId, weapon) {
  if (!self || !self.alive) return;
  let remaining = amount;
  if (self.armor > 0) {
    const absorbed = Math.min(self.armor, remaining);
    self.armor -= absorbed;
    remaining -= absorbed;
  }
  self.hp -= remaining;
  updateHealthHud();
  vignette();
  if (self.hp <= 0) die(byId, weapon);
}

function die(byId, weapon) {
  if (!self.alive) return;
  self.alive = false;
  self.hp = 0;
  self.respawnAt = performance.now() + 3000;
  updateHealthHud();
  $("#dmgtext").style.display = "block";
  sendAction({ type: "die", by: byId, weapon });
  dropLoot();
}

function respawn() {
  if (!self.alive) return;
  self.alive = true;
  self.hp = self.maxHp;
  self.armor = self.armorMax;
  self.body.position.set(self.spawn.x, BODY_HALF, self.spawn.z);
  self.yaw = self.spawn.yaw;
  self.pitch = 0;
  self.loadout.forEach((w) => { w.clip = w.clipMax; });
  $("#dmgtext").style.display = "none";
  updateHealthHud();
  sendAction({ type: "respawn", x: self.spawn.x, z: self.spawn.z, hp: self.maxHp });
}

function dropLoot() {
  const drops = [];
  const w = currentWeapon();
  if (Math.random() < 0.7) drops.push({ id: "vx7-" + Math.random(), item: { ...ITEMS.rifle, name: ITEMS.rifle.name + " +" + w.clip } });
  if (self.armorMax > 0) drops.push({ id: "vest-" + Math.random(), item: ITEMS.vest });
  const bagIdx = self.bag.findIndex((b) => b && (b.kind === "med" || b.kind === "ammo"));
  if (bagIdx >= 0) {
    drops.push({ id: "d-" + Math.random(), item: self.bag[bagIdx] });
    self.bag[bagIdx] = null;
  }
  if (drops.length) socket.emit("loot:drop", { items: drops.map((d) => d.item), count: drops.length });
}

/* =====================================================================
   9. HUD
===================================================================== */
function updateHealthHud() {
  const hp = self ? Math.max(0, Math.ceil(self.hp)) : 100;
  const a = self ? Math.max(0, Math.ceil(self.armor)) : 0;
  $("#healthbar").style.width = `${hp}%`;
  $("#armorbar").style.width = `${a}%`;
  $("#hpval").textContent = `${hp} / ${a}`;
}
function hitFlash() {
  const el = $("#hitmarker");
  if (!el) return;
  el.style.transition = "none";
  el.style.opacity = 1;
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = "opacity .12s"; el.style.opacity = 0; }));
}
let vignetteT = 0;
function vignette() {
  vignetteT = performance.now();
  $("#vignette").style.opacity = 1;
}
function pushKill(killer, victim, weapon) {
  const feed = $("#killfeed");
  const row = document.createElement("div");
  row.className = "kf";
  row.textContent = `${killer} ✕ ${victim} [${weapon}]`;
  feed.appendChild(row);
  setTimeout(() => row.remove(), 5000);
}

function drawAbilities(now) {
  for (let i = 0; i < ABILITIES.length; i++) {
    const el = $("#ab-" + ABILITIES[i].id);
    const cd = self ? Math.max(0, self.abilityCd[i] - now) : 0;
    const cdEl = el.querySelector(".cd");
    if (cd > 0) {
      el.classList.remove("ready");
      cdEl.style.display = "flex";
      cdEl.textContent = (cd / 1000).toFixed(1);
    } else {
      el.classList.add("ready");
      cdEl.style.display = "none";
    }
  }
}

/* =====================================================================
   10. INVENTORY (Tab) + DRAG & DROP
===================================================================== */
const LOOT = new Map(); // id -> {x,z,item}
let inventoryHtml = "";

function toggleInventory() {
  if (!tabOpen) openInventory();
  else closeInventory();
}

function openInventory() {
  if (!self) return;
  tabOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  renderInventory();
  $("#inventory").classList.add("open");
}
function closeInventory() {
  tabOpen = false;
  $("#inventory").classList.remove("open");
  canvas.requestPointerLock();
}

function nearbyLoot() {
  const out = [];
  const meX = self.body.position.x;
  const meZ = self.body.position.z;
  for (const [id, l] of LOOT) {
    const d = Math.hypot(l.x - meX, l.z - meZ);
    if (d < 8) out.push({ id, ...l, dist: d });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

function renderInventory() {
  const panel = $("#inv-panel");
  const loot = nearbyLoot();
  const lootCells = loot.map((l) => cellHtml("ground", l.id, l.item, `loot-${l.id}`, `${l.dist.toFixed(1)}m`)).join("") || "<div class='inv-cell'><small>out of range</small></div>";

  const w0 = self.loadout[0], w1 = self.loadout[1];
  const weaponSlots = `
    <div class="inv-cell" data-slot="w0" data-cell="slot">${slotContent("PRIMARY", `<b>${w0.name}</b><small>${w0.clip}/${w0.reserve}</small>`)}</div>
    <div class="inv-cell" data-slot="w1" data-cell="slot">${slotContent("SECONDARY", `<b>${w1.name}</b><small>${w1.clip}/${w1.reserve}</small>`)}</div>`;
  const armorSlot = `<div class="inv-cell" data-slot="armor" data-cell="slot">${slotContent("ARMOR", self.armorMax > 0 ? `<b>Vest</b><small>${self.armor}/${self.armorMax}</small>` : "<small>empty</small>")}</div>`;

  const bagCells = self.bag.map((item, i) => item ? `<div class="inv-cell taken" data-slot="bag" data-idx="${i}" data-cell="bag"><b>${item.name}</b></div>` : `<div class="inv-cell" data-slot="bag" data-idx="${i}" data-cell="bag"><small>·</small></div>`).join("");

  panel.innerHTML = `
    <div class="inv-col">
      <h3>Ground Loot</h3>
      <div class="inv-grid loot-grid">${lootCells}</div>
    </div>
    <div class="inv-col">
      <div class="inv-grid" style="grid-template-columns:repeat(2,1fr)">${weaponSlots}</div>
      <div class="inv-grid" style="grid-template-columns:1fr;margin-top:6px">${armorSlot}</div>
      <h3 style="margin-top:14px">Backpack</h3>
      <div class="inv-grid bag-grid">${bagCells}</div>
    </div>`;

  panel.querySelectorAll(".inv-cell").forEach((cell) => {
    cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("drag-over"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const payload = JSON.parse(e.dataTransfer.getData("text/plain"));
      handleDrop(payload, cell);
      renderInventory();
    });
    cell.addEventListener("dblclick", () => {
      if (cell.dataset.cell === "ground") {
        const payload = JSON.parse(decodeURIComponent(cell.dataset.payload || "{}"));
        const item = payload.item;
        if (item && item.kind === "med") {
          socket.emit("loot:take", { id: payload.id });
          LOOT.delete(payload.id);
          self.hp = Math.min(self.maxHp, self.hp + item.heal);
          updateHealthHud();
          renderInventory();
        }
      } else if (cell.dataset.cell === "bag" && Number.isInteger(Number(cell.dataset.idx))) {
        useBagItem(self.bag[Number(cell.dataset.idx)], Number(cell.dataset.idx));
        renderInventory();
      }
    });
  });
  // ground cells draggable
  panel.querySelectorAll(".inv-cell[data-cell=ground]").forEach((c) => {
    c.draggable = true;
    c.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", decodeURIComponent(c.dataset.payload)));
  });
  // bag cells draggable
  panel.querySelectorAll(".inv-cell[data-cell=bag][data-idx]").forEach((c) => {
    if (self.bag[Number(c.dataset.idx)]) {
      c.draggable = true;
      c.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", JSON.stringify({ from: "bag", idx: Number(c.dataset.idx), item: self.bag[Number(c.dataset.idx)] })));
    }
  });
}

function cellHtml(kind, id, item, uid, extra) {
  const payload = encodeURIComponent(JSON.stringify({ from: kind, id, item }));
  return `<div class="inv-cell taken" data-cell="${kind}" data-payload="${payload}" data-uid="${uid}"><b>${item.name}</b>${extra ? `<span class="dist">${extra}</span>` : ""}</div>`;
}

function slotContent(label, inner) {
  return `<small>${label}</small>${inner}`;
}

function handleDrop(payload, cell) {
  if (!payload) return;
  if (payload.from === "ground") {
    const loot = LOOT.get(payload.id);
    if (!loot) return;
    socket.emit("loot:take", { id: payload.id });
    LOOT.delete(payload.id);
    const item = payload.item;
    if (item.kind === "weapon") equipWeaponFrom(item, undefined, cell, undefined);
    else if (item.kind === "armor") { self.armorMax = item.max; self.armor = item.max; updateHealthHud(); }
    else if (item.kind === "ammo") addAmmo(item.add);
    else if (item.kind === "med") putInBag(item);
  } else if (payload.from === "bag") {
    const idx = payload.idx;
    const item = payload.item;
    if (!item || self.bag[idx] !== item) return;
    if (cell.dataset.slot === "w0" || cell.dataset.slot === "w1") {
      if (item.kind === "weapon") {
        equipWeaponFrom(item, undefined, cell, idx);
      } else if (item.kind === "armor") {
        self.armorMax = item.max;
        self.armor = item.max;
        self.bag[idx] = null;
        updateHealthHud();
      }
    } else if (cell.dataset.slot === "bag") {
      /* re-arrange within backpack: no-op for the prototype */
    }
  }
}

function equipWeaponFrom(item, extraClip, cell, fromBagIdx) {
  const slot = cell.dataset.slot === "w0" ? 0 : 1;
  const w = { ...WEAPONS[item.weaponIdx], clip: extraClip ?? WEAPONS[item.weaponIdx].clipMax, reserve: WEAPONS[item.weaponIdx].reserveMax };
  const old = self.loadout[slot];
  self.loadout[slot] = w;
  if (old) {
    const oldItem = { id: old.id, name: old.name, kind: "weapon", weaponIdx: old.id === "vx7" ? 0 : 1 };
    if (Number.isInteger(fromBagIdx)) self.bag[fromBagIdx] = oldItem;
    else putInBag(oldItem);
  } else if (Number.isInteger(fromBagIdx)) {
    self.bag[fromBagIdx] = null;
  }
  switchWeapon(slot);
}
function addAmmo(n) {
  self.loadout.forEach((w) => { w.reserve = Math.min(w.reserveMax, w.reserve + n); });
  updateAmmoHud();
}
function putInBag(item) {
  const idx = self.bag.findIndex((b) => !b);
  if (idx >= 0) self.bag[idx] = item;
}
function useBagItem(item, fromBagIdx) {
  if (!item) return;
  if (item.kind === "med") {
    self.hp = Math.min(self.maxHp, self.hp + item.heal);
    if (Number.isInteger(fromBagIdx)) self.bag[fromBagIdx] = null;
    updateHealthHud();
  } else if (item.kind === "ammo") {
    addAmmo(item.add);
    if (Number.isInteger(fromBagIdx)) self.bag[fromBagIdx] = null;
    updateAmmoHud();
  }
}

/* =====================================================================
   11. NETWORKING — Socket.io + WebRTC mesh
===================================================================== */
const rtcConfig = { iceServers: [] };

function openPeer(id) {
  if (peers.has(id)) return;
  const pc = new RTCPeerConnection(rtcConfig);
  const entry = { pc, connected: false, channel: null };
  peers.set(id, entry);

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("rtc:ice", { to: id, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
  };

  pc.ondatachannel = (e) => { entry.channel = e.channel; wireChannel(id, entry.channel); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") { peers.delete(id); peerChannels.delete(id); }
  };
  return entry;
}

function wireChannel(id, ch) {
  ch.onopen = () => { entry_channel_open(id, ch); };
  ch.onmessage = (e) => {
    const s = String(e.data);
    if (s.startsWith("s:")) {
      try { pushRemoteState(id, JSON.parse(s.slice(2))); } catch {}
    }
  };
}
function entry_channel_open(id, ch) {
  const entry = peers.get(id);
  if (entry) entry.connected = true;
  peerChannels.set(id, ch);
}

function emitStateToPeer(id, pkt) {
  const ch = peerChannels.get(id);
  if (ch && ch.readyState === "open") {
    ch.send("s:" + JSON.stringify(pkt));
  } else {
    socket.emit("state", { peer: id, pkt });
  }
}

let pktAcc = 0;
function broadcastSelfState(now) {
  if (!self || !me) return;
  if (now - pktAcc < 33) return;
  pktAcc = now;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, self.yaw, 0, "YXZ"));
  const pkt = {
    t: now / 1000,
    x: self.body.position.x,
    y: self.body.position.y,
    z: self.body.position.z,
    qx: q.x, qy: q.y, qz: q.z, qw: q.w,
    w: self.weaponIdx,
    hp: Math.max(0, Math.ceil(self.hp)),
    alive: self.alive,
    anim: self.readies ? self.anim : "idle",
  };
  const ids = [...remotes.keys()];
  for (const id of ids) emitStateToPeer(id, pkt);
}

function sendAction(a) { socket.emit("action", a); }

function connect(name) {
  socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => { socket.emit("hello", { name }); });
  socket.on("connect_error", (e) => { window.__dbg.err.push("connect_error " + e.message); });

  socket.on("welcome", (w) => {
    me = { id: w.id, name: w.name, team: w.team };
    joiningEl.style.display = "none";
    self = new Player(w.name, w.team, w.spawn);
    me.spawn = w.spawn;
    self.spawn = w.spawn;
    setViewmodel("rifle");
    camera.position.set(w.spawn.x, BODY_HALF + self.eyeOffset, w.spawn.z);
    updateHealthHud();
    updateAmmoHud();
    for (const p of w.players) if (p.id !== me.id) addRemote(p);
    for (const l of w.loot) LOOT.set(l.id, l);

    // open a channel to every already-present peer (they will also request us)
    for (const p of w.players) if (p.id !== me.id) openPeer(p.id);
  });

  socket.on("join", (p) => { addRemote(p); openPeer(p.id); });
  socket.on("leave", (p) => {
    removeRemote(p.id);
    const e = peers.get(p.id);
    if (e) {
      try { e.pc.close(); } catch {}
      peers.delete(p.id);
      peerChannels.delete(p.id);
    }
  });

  socket.on("state", (m) => pushRemoteState(m.from, m.pkt));

  socket.on("action", (m) => {
    if (m.type === "hurt" && m.to === me.id) applyDamage(m.amount, m.by, m.weapon);
    else if (m.type === "die") {
      if (m.by === me.id && self) self.kills++;
      pushKill(rosterName(m.by), rosterName(m.from), m.weapon);
      const r = remotes.get(m.from);
      if (r) {
        r.group.visible = false;
        r.history = [];
      }
    } else if (m.type === "respawn") {
      const r = remotes.get(m.from);
      if (r) {
        r.group.position.set(m.x, 0, m.z);
        r.group.visible = true;
        r.hp = m.hp;
        r.history = [];
      }
    } else if (m.type === "smoke") {
      spawnSmoke(m.x, m.y, m.z, m.team, true);
    }
  });

  socket.on("loot:add", (l) => LOOT.set(l.id, l));
  socket.on("loot:remove", (l) => LOOT.delete(l.id));

  // WebRTC signaling
  socket.on("rtc:request", (m) => {
    if (m.with !== me.id) return;
    const entry = openPeer(m.with);
    if (m.initiator) {
      const ch = entry.pc.createDataChannel("state");
      entry.channel = ch;
      wireChannel(m.with, ch);
      entry.pc.onnegotiationneeded = async () => {
        try {
          const offer = await entry.pc.createOffer();
          await entry.pc.setLocalDescription(offer);
          socket.emit("rtc:offer", { to: m.with, sdp: entry.pc.localDescription });
        } catch {}
      };
    }
  });
  socket.on("rtc:offer", async (m) => {
    if (m.from === me.id) return;
    const entry = openPeer(m.from);
    try {
      await entry.pc.setRemoteDescription(m.sdp);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      socket.emit("rtc:answer", { to: m.from, sdp: entry.pc.localDescription });
    } catch {}
  });
  socket.on("rtc:answer", async (m) => {
    const entry = peers.get(m.from);
    if (!entry) return;
    try { await entry.pc.setRemoteDescription(m.sdp); } catch {}
  });
  socket.on("rtc:ice", async (m) => {
    const entry = peers.get(m.from);
    if (!entry || !m.candidate) return;
    try { await entry.pc.addIceCandidate(m.candidate); } catch {}
  });
}

function rosterName(id) {
  if (id === me?.id) return me?.name ?? "?";
  return remotes.get(id)?.name ?? "?";
}

/* =====================================================================
   12. PER-FRAME LOOP
===================================================================== */
const clock = new THREE.Clock();

const muzzleLight = new THREE.PointLight(0xffb25c, 30, 6);
muzzleLight.position.set(0, -100, 0);
scene.add(muzzleLight);

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();

  if (self) {
    // --- input steering ---
    const fx = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const fz = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const mag = Math.hypot(fx, fz);
    const nx = mag > 0 ? fx / mag : 0;
    const nz = mag > 0 ? fz / mag : 0;
    self.crouching = keys.has("ControlLeft") && !keys.has("ShiftLeft");
    const grounded = world.isGrounded(self.body);
    const sprinting = keys.has("ShiftLeft") && grounded && !self.crouching;

    let speed = self.crouching ? CROUCH : sprinting ? SPRINT : WALK;
    if (!grounded) speed *= AIR_PENALTY;
    const jump = keys.has("Space") && grounded ? JUMP : 0;
    world.setPlayerMove(self.body, nx, nz, speed, jump, dt);
    world.friction(self.body, keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD") ? 1 : 0.35, dt);
    world.step(dt);

    const v = self.body.velocity;
    self.anim = self.alive
      ? (self.crouching ? "crouch" : sprinting ? "sprint" : Math.hypot(v.x, v.z) > 0.4 ? "run" : grounded ? "idle" : "jump")
      : "dead";

    // eye height + camera
    const targetOffset = self.crouching ? CROUCH_EYE - BODY_HALF : STAND_EYE - BODY_HALF;
    self.eyeOffset += (targetOffset - self.eyeOffset) * Math.min(1, dt * 10);
    camera.position.set(self.body.position.x, self.body.position.y + self.eyeOffset, self.body.position.z);

    // third-person body (hidden in first person) tracks + animates
    self.group.position.set(self.body.position.x, self.body.position.y - BODY_HALF, self.body.position.z);
    self.group.rotation.y = self.yaw;
    self.group.userData.anim = self.anim;

    // knife slash restores the gun viewmodel after the swing
    if (self.viewKey === "blade" && self.viewUntil && now >= self.viewUntil) {
      setViewmodel(self.weaponIdx === 0 ? "rifle" : "sidearm");
    }

    // recoil decays smoothly back to zero
    self.recoilPitch = lerpAngle(self.recoilPitch, 0, Math.min(1, dt * 4.2));
    self.recoilYaw = lerpAngle(self.recoilYaw, 0, Math.min(1, dt * 5));

    // muzzle flash light
    const flash = self.muzzle > 0 && (now - self.muzzle) < 45;
    muzzleLight.visible = flash;
    if (flash) muzzleLight.position.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.6));

    camera.rotation.set(
      self.pitch + self.recoilPitch,
      self.yaw + self.recoilYaw,
      0,
    );

    // reload finish
    if (self.reloading && now >= self.reloadDoneAt) {
      self.reloading = false;
      const w = currentWeapon();
      const take = Math.min(w.clipMax - w.clip, w.reserve);
      w.clip += take;
      w.reserve -= take;
      updateAmmoHud();
    }

    // respawn
    if (!self.alive && now >= self.respawnAt) respawn();

    // stim regen
    if (self.stimHp > 0) {
      const heal = Math.min(self.stimHp, dt * 20);
      self.hp = Math.min(self.maxHp, self.hp + heal);
      self.stimHp -= heal;
      if (self.stimHp < 0.001) self.stimHp = 0;
      updateHealthHud();
    }

    // firing (auto only in the loop; semi fires on mousedown)
    if (self.alive && mouseDown && !self.reloading && !tabOpen && currentWeapon().auto) fire();

    // vignette decay
    if (vignetteT && now - vignetteT > 300) $("#vignette").style.opacity = 0;
    drawAbilities(now);

    broadcastSelfState(now);
  }

  // --- remote interpolation ---
  for (const r of remotes.values()) {
    const h = r.history;
    if (h.length === 0) continue;
    const targetT = now / 1000 - INTERP_DELAY;
    let i = h.length - 1;
    while (i > 0 && h[i].t > targetT) i--;
    const a = h[i];
    const b = h[Math.min(i + 1, h.length - 1)];
    const span = Math.max(0.0001, b.t - a.t);
    const f = Math.max(0, Math.min(1, (targetT - a.t) / span));
    if (now / 1000 - b.t > 0.6) {
      r.group.position.set(b.x, b.y - BODY_HALF, b.z);
      r.group.quaternion.set(b.qx, b.qy, b.qz, b.qw);
    } else if (a === b) {
      r.group.position.set(a.x, a.y - BODY_HALF, a.z);
      r.group.quaternion.set(a.qx, a.qy, a.qz, a.qw);
    } else {
      r.group.position.set(a.x + (b.x - a.x) * f, (a.y - BODY_HALF) + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      const qa = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw);
      const qb = new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw);
      r.group.quaternion.slerpQuaternions(qa, qb, f);
    }
    r.last = b;
    r.group.userData.anim = b.anim ?? "idle";
    syncWeaponInHand(r.group, b.w ?? 0);
    if (h.length > 2 && b.alive === false) r.group.visible = false;
  }

  // drive cloned character animation from each humanoid's state
  for (const e of mixers) {
    e.mixer.timeScale = animTimeScale(e.group.userData.anim || "idle");
    e.mixer.update(dt);
  }
  // swap in the real model for any humanoid still waiting on the character GLB
  for (const g of [...humanoidsAwaitingModel]) maybePatchModel(g);

  // smoke expansion
  for (const v of smokeVolumes) {
    const p = Math.min(1, (now - v.bornAt) / 400);
    v.group.children.forEach((c) => c.scale.setScalar(Math.max(0.1, p)));
  }

  renderer.render(scene, camera);
}

function lerpAngle(a, b, t) { return a + (b - a) * t; }

/* =====================================================================
   13. BOOT
===================================================================== */
$("#join").addEventListener("click", () => {
  const name = ($("#name").value || "").trim().slice(0, 20) || "Stray";
  connectingUser(name);
});
$("#name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const name = ($("#name").value || "").trim().slice(0, 20) || "Stray";
    connectingUser(name);
  }
});

function connectingUser(name) {
  $("#join").disabled = true;
  connect(name);
}

requestAnimationFrame(frame);