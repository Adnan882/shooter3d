# Shooter3D

A browser-based, no-install multiplayer 3D team shooter. Drop a link, join a party, and play a team deathmatch in the browser with no downloads.

## Quickstart

```sh
npm install
npm run dev:server   # REST + Colyseus on http://localhost:2567
npm run dev:client   # Vite dev server on http://localhost:5173
```

Open http://localhost:5173 in two browser windows, click **QUICK PLAY** on each, hit **READY** and **FIND MATCH** to start a 1v1 (teams size defaults to 5; both parties must be fully seated and ready to match).

## How to play

- WASD: move, Space: jump, Ctrl/C: crouch, Shift: sprint
- Mouse: look, LMB: fire (hold to auto-fire rifle), R: reload, 1/2: weapon switch
- Kill 20 enemies before the 5-minute timer to win the TDM round

Flow: guest login (one-click, no account) → create or join a party via invite link → ready up → leader finds a match → auto-join into the arena.

## Architecture

npm workspaces, three TypeScript packages:

| Package  | Role |
|----------|------|
| `shared/` | Single source of truth for the network schema (`@colyseus/schema` v3), game config/balance, map presets, and movement helpers. Imported by both server and client. |
| `server/` | Node 20 + `tsx` runtime. Express REST auth (`POST /api/auth/guest`), Colyseus rooms, and the authoritative simulation (movement, hitscan, damage, respawn, match scoring) at 30 Hz. |
| `client/` | Vite + Babylon.js SPA: home / party / loading / game / results screens, HUD, 3D scene rendering, input→message encoding. |

Server rooms:

- `party` — leader-only matchmaking gating. Members ready up; leader triggers `find_match`; the matchmaker fills two adjacent matches and sends each team a `join_match` offer.
- `game` — the live arena. Clients authorize with a signed match token, stream inputs, and receive the decoded `GameRoomState` (players, kill feed, score, map id).

## Commands

```sh
npm run dev:server       # server on 2567 (TEAM_SIZE env overrides squad size)
npm run dev:client       # vite on 5173
npm run typecheck        # tsc across all workspaces
npm test                 # server unit + end-to-end tests (node --import tsx --test)
npm run build:client     # production client bundle
node scripts/playtest.mjs  # headless 2-browser UI regression (needs both dev servers running)
```

Server tests include a full networked round-trip e2e: two parties ready, match join, movement across the map, firing, and an online kill.

## Networking notes

- Colyseus 0.16.5 + `@colyseus/schema` 3.x. In v3, schema callbacks live on decoded state proxies, not instance methods — the client uses `getDecoderStateCallbacks()` so UI/rendering reacts to state (see `client/src/schemaCallbacks.ts`).
- Guest auth issues a signed JWT; the game room only accepts clients holding a match token minted by the matchmaker.
- The simulation is authoritative: clients send input+sequence numbers and render server state.

## Tactical prototype (`tactical/`)

Side-by-side prototype exploring hero-style mechanics on a looter-shooter baseline. Plain Three.js + Cannon-es + Socket.io/WebRTC (no engine), vanilla ES modules — the architecture is deliberately transparent so game feel and netcode are easy to iterate on.

```sh
cd tactical
npm install
node server.js     # http://localhost:3567
```

Open http://localhost:3567 in two browser windows (or `npm install -g` nothing — plain module scripts), enter a callsign, click **DEPLOY**. Open a bigger window for better fights.

Spec implemented:

- Fullscreen WebGL canvas, Pointer Lock on click, FOV 90.
- WASD/Space/Shift/Ctrl movement over Cannon-es with velocity + friction and a 50% air-strafe penalty.
- Mouse look: unlimited yaw, pitch clamped to ±85°.
- Hitscan raycast gunplay from the camera center with recoil that smoothly decays back to zero.
- Abilities: **Q** frag grenade (AOE), **E** smoke projectile (grey volumetric sphere, 15 s), **C** stim (regen), **X** knife melee. Cooldowns shown on the HUD.
- Crosshair: 4px `#00FF00` dot with a 1px black outline.
- 300×20 health/armor bars bottom-left with `100 / 0` text; ammo `30 / 90` bottom-right.
- PUBG-style **Tab** inventory: nearby ground loot, equipment slots (2 weapons, armor) + 5×4 backpack, HTML5 drag-and-drop, double-click to use meds/ammo.
- Networking: 60Hz broadcast of position/quaternion/anim, client-side prediction via the local physics body, entity interpolation (100 ms buffer) for remotes, and a WebRTC mesh data channel (`state`) with a per-peer Socket.io relay fallback on the same 60Hz cadence. Socket.io also handles signaling, targeted `action` events, and an authoritative ground-loot store.
- Your uploaded GLBs are wired in (`3D MODELS/` → `tactical/public/models/`, loaded via GLTFLoader): `character.glb` is the rigged/animated player model (animation mixer driven by movement state, team tint on B, team ring + name tag), `rifle.glb`/`sidearm.glb` are the two weapons (held in the character's `RightHand` bone on remotes, camera-attached as the first-person viewmodel), and `blade.glb` is the knife. Anchor/pose offsets are constants in `tactical/public/main.js` (`WEAPON_ANCHOR_*`, `VIEW_*`, `CHAR_FACE_OFFSET`) — tweak per model; `tactical/public/_preview.html` renders all four on a grid for quick tuning.

Smoke test:

```sh
cd tactical
node smoke.mjs      # 2 headless players join, validates 60Hz flow + character render
```