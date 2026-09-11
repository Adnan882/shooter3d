import {
  Color3,
  MeshBuilder,
  Scene,
  PBRMaterial,
} from "babylonjs";
import { type MapConfig } from "@shooter/shared";

const _matCache = new Map<string, PBRMaterial>();

export function material(scene: Scene, colorHex: string) {
  const key = `m_${colorHex}`;
  const hit = _matCache.get(key);
  if (hit) return hit;
  const mat = new PBRMaterial(key, scene);
  mat.albedoColor = Color3.FromHexString(colorHex);
  mat.metallic = 0.1;
  mat.roughness = 0.9;
  _matCache.set(key, mat);
  return mat;
}

export function buildMap(scene: Scene, map: MapConfig) {
  const bounds = map.bounds;

  const ground = MeshBuilder.CreateGround(
    "ground",
    {
      width: (bounds.max.x - bounds.min.x) * 2,
      height: (bounds.max.z - bounds.min.z) * 2,
    },
    scene,
  );
  ground.position.y = 0;
  ground.material = material(scene, map.groundColor);

  for (const b of map.boxes) {
    const key = `${b.min.x},${b.min.y},${b.min.z},${b.max.x},${b.max.y},${b.max.z}`;
    if (b.shape === "cylinder") {
      const r = (b.max.x - b.min.x) / 2;
      const h = b.max.y - b.min.y;
      const cy = MeshBuilder.CreateCylinder(`cyl_${key}`, {
        diameter: r * 2,
        height: h,
        tessellation: 24,
      }, scene);
      cy.position.set((b.min.x + b.max.x) / 2, b.min.y + h / 2, (b.min.z + b.max.z) / 2);
      cy.material = material(scene, b.color);
    } else {
      const w = b.max.x - b.min.x;
      const h = b.max.y - b.min.y;
      const d = b.max.z - b.min.z;
      const box = MeshBuilder.CreateBox(`box_${key}`, { width: w, height: h, depth: d }, scene);
      box.position.set((b.min.x + b.max.x) / 2, b.min.y + h / 2, (b.min.z + b.max.z) / 2);
      box.material = material(scene, b.color);
    }
  }
}