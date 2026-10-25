import { findGeometry, type Bone, type Geometry, type Vec3 } from './geometry.ts';
import { addBufferView, addFloatAccessor, createBuilder, toGlb } from './glb.ts';
import { addCube, addPolyMesh, toOut, toQuat, type Primitive } from './mesh.ts';
import { HUMANOID_CUSTOM, HUMANOID_CUSTOM_SLIM } from './standard.ts';

export { clientDataToGlb, type ClientData } from './client-data.ts';

export interface SkinInput {
  /** スキン画像 (PNG) */
  skin: Uint8Array;
  /** LoginパケットのSkinGeometryDataをJSONとして読んだもの */
  geometry?: unknown;
  /** LoginパケットのSkinResourcePatchをJSONとして読んだもの (`{ geometry: { default: ... } }`) */
  resourcePatch?: unknown;
  /** LoginパケットのAnimatedImageDataの画像 (PNG) */
  animatedImages?: Uint8Array[];
  /** geometryが見つからないときに使う標準スキンの体型 (`wide` / `slim`) */
  armSize?: string;
}

interface Layer {
  geometry: Geometry;
  png: Uint8Array;
}

/**
 * LoginパケットのスキンをGLBにする。
 * Persona APIのGLBと同じ座標・単位・ノード名で、体全体の表示に使える形にする
 */
export function skinToGlb(input: SkinInput): Uint8Array {
  const layers = collectLayers(input);
  const builder = createBuilder();

  const json = {
    asset: { version: '2.0', generator: 'bedrock-skin-gltf' },
    scene: 0,
    scenes: [{ nodes: [] as number[] }],
    nodes: [] as Record<string, unknown>[],
    meshes: [] as Record<string, unknown>[],
    materials: layers.map((_, i) => ({
      alphaMode: 'MASK',
      doubleSided: true,
      pbrMetallicRoughness: { baseColorTexture: { index: i }, metallicFactor: 0 },
    })),
    textures: layers.map((_, i) => ({ sampler: 0, source: i })),
    images: layers.map((layer) => ({
      bufferView: addBufferView(builder, layer.png),
      mimeType: 'image/png',
    })),
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
  };

  const bones = mergeBones(layers);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const key of bones.keys()) {
    const parent = parentKey(bones, key);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), key]);
    else roots.push(key);
  }

  const pivotOf = (key: string | undefined): Vec3 =>
    key ? toOut(bones.get(key)?.pivot ?? [0, 0, 0]) : [0, 0, 0];

  /** ノードを作って番号を返す。メッシュも子も無いboneは省く */
  const build = (key: string): number | null => {
    const bone = bones.get(key)!;
    const pivot = pivotOf(key);
    const primitives = layers.flatMap((layer, material) => {
      const target = layer.geometry.bones.find((b) => lower(b.name) === key);
      if (!target || target.neverRender) return [];
      const out: Primitive = { positions: [], normals: [], uvs: [] };
      const texture = { width: layer.geometry.textureWidth, height: layer.geometry.textureHeight };
      for (const cube of target.cubes ?? []) addCube(out, cube, target, pivot, texture);
      if (target.poly_mesh) addPolyMesh(out, target.poly_mesh, pivot, texture);
      if (out.positions.length === 0) return [];
      return [
        {
          attributes: {
            POSITION: addFloatAccessor(builder, out.positions, 'VEC3', true),
            NORMAL: addFloatAccessor(builder, out.normals, 'VEC3'),
            TEXCOORD_0: addFloatAccessor(builder, out.uvs, 'VEC2'),
          },
          material,
        },
      ];
    });
    const childNodes = (children.get(key) ?? []).map(build).filter((n) => n !== null);
    if (primitives.length === 0 && childNodes.length === 0) return null;

    const parentPivot = pivotOf(parentKey(bones, key));
    const translation = pivot.map((v, i) => v - parentPivot[i]!);
    const rotation = toQuat(bone.rotation);
    const node: Record<string, unknown> = { name: canonicalName(bone.name!) };
    if (childNodes.length > 0) node.children = childNodes;
    if (primitives.length > 0) {
      json.meshes.push({ primitives });
      node.mesh = json.meshes.length - 1;
    }
    if (translation.some((v) => v !== 0)) node.translation = translation;
    if (rotation) node.rotation = rotation;
    json.nodes.push(node);
    return json.nodes.length - 1;
  };

  json.scenes[0]!.nodes = roots.map(build).filter((n) => n !== null);
  return toGlb(builder, json);
}

const lower = (name: string | undefined) => (name ?? '').toLowerCase();

/** resource patchの各ジオメトリと画像の組。defaultはスキン画像、それ以外は同じサイズのアニメーション画像 */
function collectLayers(input: SkinInput): Layer[] {
  const patch =
    (input.resourcePatch as { geometry?: Record<string, unknown> } | null | undefined)?.geometry ??
    {};
  const images = (input.animatedImages ?? []).map((png) => ({ png, ...pngSize(png) }));
  const used = new Set<(typeof images)[number]>();
  const layers: Layer[] = [];
  for (const [key, id] of Object.entries(patch)) {
    const geometry = typeof id === 'string' ? findGeometry(input.geometry, id) : null;
    if (!geometry) continue;
    if (key === 'default') {
      layers.unshift({ geometry, png: input.skin });
      continue;
    }
    const image = images.find(
      (img) =>
        !used.has(img) &&
        img.width === geometry.textureWidth &&
        img.height === geometry.textureHeight,
    );
    if (image) {
      used.add(image);
      layers.push({ geometry, png: image.png });
    }
  }
  if (layers.length > 0) return layers;
  return [
    {
      geometry: input.armSize === 'slim' ? HUMANOID_CUSTOM_SLIM : HUMANOID_CUSTOM,
      png: input.skin,
    },
  ];
}

/** 全レイヤーのboneを名前 (大文字小文字は区別しない) でまとめる。先に出てきたものを使う */
function mergeBones(layers: Layer[]): Map<string, Bone> {
  const bones = new Map<string, Bone>();
  for (const layer of layers) {
    for (const bone of layer.geometry.bones) {
      const key = lower(bone.name);
      if (key && !bones.has(key)) bones.set(key, bone);
    }
  }
  return bones;
}

/** 親のキー。親が無い・循環しているときはundefined */
function parentKey(bones: Map<string, Bone>, key: string): string | undefined {
  const parent = lower(bones.get(key)?.parent);
  if (!bones.has(parent)) return;
  const seen = new Set([key]);
  for (let k = parent; bones.has(k); k = lower(bones.get(k)?.parent)) {
    if (seen.has(k)) return;
    seen.add(k);
  }
  return parent;
}

/** Persona APIのGLBと同じ名前にする (ペルソナスキンのgeometryは小文字) */
const CANONICAL_NAMES = new Map(
  [...HUMANOID_CUSTOM.bones, ...HUMANOID_CUSTOM_SLIM.bones].map((b) => [lower(b.name), b.name!]),
);
const canonicalName = (name: string) => CANONICAL_NAMES.get(lower(name)) ?? name;

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.byteLength < 24 || view.getUint32(0) !== 0x89504e47) {
    throw new Error('not a PNG');
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
