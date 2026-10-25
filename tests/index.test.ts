import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import { decode } from 'fast-png';
import { clientDataToGlb, skinToGlb, type ClientData, type SkinInput } from '../src/index.ts';

// fixturesはプレイヤーのスキンなのでリポジトリに含めない (.gitignore)
const FIXTURES = join(import.meta.dirname, '../fixtures');
const SKINS = join(FIXTURES, 'skins');
const PERSONA = join(FIXTURES, 'persona-standard.glb');

interface Gltf {
  nodes: { name: string; children?: number[]; mesh?: number; translation?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { min?: number[]; max?: number[]; count: number }[];
  scenes: { nodes: number[] }[];
}

function parseGlb(glb: Uint8Array): Gltf {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

/** ノードごとの親・親基準の位置・メッシュの範囲 (ノード基準) */
function summarize(gltf: Gltf) {
  const result: Record<string, { parent?: string; translation: number[]; bounds?: number[][] }> =
    {};
  const visit = (i: number, parent?: string) => {
    const node = gltf.nodes[i]!;
    const bounds = node.mesh === undefined ? undefined : meshBounds(gltf, node.mesh);
    result[node.name] = { parent, translation: node.translation ?? [0, 0, 0], bounds };
    for (const child of node.children ?? []) visit(child, node.name);
  };
  for (const root of gltf.scenes[0]!.nodes) visit(root);
  return result;
}

function meshBounds(gltf: Gltf, mesh: number) {
  const accessors = gltf.meshes[mesh]!.primitives.map(
    (p) => gltf.accessors[p.attributes.POSITION!]!,
  );
  // float32の誤差 (1.9999998など) を無視する
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return [
    [0, 1, 2].map((i) => round(Math.min(...accessors.map((a) => a.min![i]!)))),
    [0, 1, 2].map((i) => round(Math.max(...accessors.map((a) => a.max![i]!)))),
  ];
}

function readSkin(dir: string): SkinInput {
  const meta = JSON.parse(readFileSync(join(dir, 'skin_meta.json'), 'utf8'));
  const animatedImages = [0, 1, 2]
    .map((i) => join(dir, `persona_${i}.png`))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path));
  return {
    skin: readFileSync(join(dir, 'skin.png')),
    geometry: JSON.parse(readFileSync(join(dir, 'geometry.json'), 'utf8')),
    resourcePatch: meta.skin_resource_patch,
    animatedImages,
    armSize: meta.arm_size,
  };
}

describe.skipIf(!existsSync(PERSONA))('Persona APIのGLBと同じ形', () => {
  test('標準の人型 (wide)', () => {
    // 同じアカウントのLoginパケットのスキン。着ているスキンは違うが体型は同じ
    const ours = summarize(parseGlb(skinToGlb(readSkin(join(SKINS, 'standard')))));
    const persona = summarize(parseGlb(readFileSync(PERSONA)));
    expect(ours).toEqual(persona);
  });
});

/** fixturesのスキンをclient dataのclaimsの形に戻す */
function toClientData(input: SkinInput): ClientData {
  const rgba = (png: Uint8Array) => {
    const image = decode(png);
    const data = new Uint8Array(image.width * image.height * 4);
    for (let i = 0; i < image.width * image.height; i++) {
      for (let ch = 0; ch < 4; ch++) {
        data[i * 4 + ch] = ch < image.channels ? image.data[i * image.channels + ch]! : 255;
      }
    }
    return { base64: Buffer.from(data).toString('base64'), ...image };
  };
  const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
  const skin = rgba(input.skin);
  return {
    SkinData: skin.base64,
    SkinImageWidth: skin.width,
    SkinImageHeight: skin.height,
    SkinGeometryData: json(input.geometry),
    SkinResourcePatch: json(input.resourcePatch),
    ArmSize: input.armSize,
    AnimatedImageData: input.animatedImages?.map((png) => {
      const image = rgba(png);
      return { Image: image.base64, ImageWidth: image.width, ImageHeight: image.height };
    }),
  };
}

describe.skipIf(!existsSync(SKINS))('client dataのclaimsから変換できる', () => {
  test.each([
    ['標準の人型', 'standard'],
    ['ペルソナスキン', 'persona'],
  ])('%s', (_, id) => {
    const input = readSkin(join(SKINS, id));
    const ours = summarize(parseGlb(clientDataToGlb(toClientData(input))));
    expect(ours).toEqual(summarize(parseGlb(skinToGlb(input))));
  });
});

describe.skipIf(!existsSync(SKINS))('fixturesのスキンを全部変換できる', () => {
  const dirs = existsSync(SKINS)
    ? readdirSync(SKINS).filter((id) => existsSync(join(SKINS, id, 'skin.png')))
    : [];
  test.each(dirs)('%s', (id) => {
    const gltf = parseGlb(skinToGlb(readSkin(join(SKINS, id))));
    expect(gltf.meshes.length).toBeGreaterThan(0);
  });
});
