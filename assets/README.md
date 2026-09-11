# Assets

Current build is fully procedural / primitives — no binary assets are required to run the game.
This folder is where sourced assets (and the notes for sourcing them) will live.

## Checklist of things to source

**Required** (gameplay-critical):

- [ ] Player capsule/torso model (placeholder: colored capsule + team color). Needs a low-poly humanoid ~2k tris with an idle/run pose for the respawn floater.
- [ ] Weapon models — VX-7 Rifle and M9 Sidearm view- / world-models (currently invisible; fire is hitscan, muzzle indication is planned).
- [ ] Impact / hitmarker / damage-flash sprites and sounds.

**Visual polish**:

- [ ] Skybox (currently a flat gradient background color).
- [ ] Ground/wall material textures; normal maps (Scorched Compound, Canal Block, Amber Outpost are all flat PBR colors).
- [ ] High-detail map props: crates, containers, barricades to replace simple boxes.
- [ ] Screen-space particles for gunfire and muzzle flash.
- [ ] Post-processing (bloom/tone mapping).

**Audio**:

- [ ] Weapon fire (distinct per weapon), reload, footsteps, jump/land.
- [ ] Hit/kill sounds, round-start and match-end stingers, UI clicks.
- [ ] Ambient/looping environment audio per map.

**UI**:

- [ ] Logo + styled buttons/icons; custom cursor/crosshair art.
- [ ] Map thumbnails for the (planned) map-picker on the results screen.

## Formatting conventions

- Models: glTF 2.0 (`.glb`), Draco-compressed, under 4 MB.
- Textures: KTX2/Basis with mipmaps, ≤ 2048², PBR (metal/rough).
- Audio: Ogg Vorbis for streaming, 22–48 kHz mono.
- Put each asset under a named subfolder (e.g. `models/`, `textures/`, `sounds/`, `ui/`) and reference it by relative path from `client/` so the Vite public dir handles the copying.