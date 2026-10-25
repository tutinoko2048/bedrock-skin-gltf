import { HUMANOID_CUSTOM, HUMANOID_CUSTOM_SLIM } from './standard.ts';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface FaceUv {
  uv: Vec2;
  uv_size?: Vec2;
}

export type FaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export interface Cube {
  origin?: Vec3;
  size?: Vec3;
  inflate?: number;
  pivot?: Vec3;
  rotation?: Vec3;
  mirror?: boolean;
  uv?: Vec2 | Partial<Record<FaceName, FaceUv>>;
}

export interface PolyMesh {
  normalized_uvs?: boolean;
  positions?: Vec3[];
  normals?: Vec3[];
  uvs?: Vec2[];
  polys?: [number, number, number][][] | 'tri_list' | 'quad_list';
}

export interface Bone {
  name?: string;
  parent?: string;
  pivot?: Vec3;
  rotation?: Vec3;
  mirror?: boolean;
  inflate?: number;
  neverRender?: boolean;
  cubes?: Cube[];
  poly_mesh?: PolyMesh;
}

export interface Geometry {
  textureWidth: number;
  textureHeight: number;
  bones: Bone[];
}

/** 1.12.0以降の形式と1.8.0の旧形式の両方からidentifierで探す */
export function findGeometry(json: unknown, id: string): Geometry | null {
  if (json && typeof json === 'object') {
    // oxlint-disable-next-line typescript/no-explicit-any -- 外部から来る任意のJSON
    const root = json as Record<string, any>;
    const list = root['minecraft:geometry'];
    if (Array.isArray(list)) {
      const geo = list.find((g) => g?.description?.identifier === id);
      if (geo) {
        return {
          textureWidth: geo.description.texture_width ?? 64,
          textureHeight: geo.description.texture_height ?? 64,
          bones: bonesOf(geo.bones),
        };
      }
    } else {
      // 旧形式: "geometry.foo" または "geometry.foo:geometry.parent"
      const key = Object.keys(root).find((k) => k === id || k.startsWith(`${id}:`));
      const geo = key ? root[key] : undefined;
      if (geo) {
        return {
          textureWidth: geo.texturewidth ?? 64,
          textureHeight: geo.textureheight ?? 64,
          bones: bonesOf(geo.bones),
        };
      }
    }
  }
  // geometry.jsonが無い標準スキン
  if (id === 'geometry.humanoid.custom') return HUMANOID_CUSTOM;
  if (id === 'geometry.humanoid.customSlim') return HUMANOID_CUSTOM_SLIM;
  return null;
}

const bonesOf = (bones: unknown): Bone[] =>
  Array.isArray(bones) ? bones.filter((b) => b && typeof b === 'object') : [];
