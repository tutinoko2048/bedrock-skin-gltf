/**
 * geometryのcube・poly_meshを三角形にする。
 *
 * 出力はPersona APIのGLBと同じ座標: Bedrockの座標のZを反転した (x, y, -z)。単位はピクセルのまま。
 * キャラクターは+Zを向き、右側が-X。
 */
import type { Bone, Cube, FaceName, PolyMesh, Vec2, Vec3 } from './geometry.ts';

export interface Primitive {
  positions: number[];
  normals: number[];
  uvs: number[];
}

export type Quat = [number, number, number, number];

export const toOut = ([x, y, z]: Vec3): Vec3 => [x, y, -z];

/** Bedrockの回転 (度、X→Y→Zの順) を出力の座標での回転にする */
export function toQuat(rotation: Vec3 | undefined): Quat | null {
  if (!rotation || rotation.every((r) => r === 0)) return null;
  const [rx, ry, rz] = rotation;
  // Zを反転したのでX以外の符号が逆になる
  const axis = (i: 0 | 1 | 2, deg: number): Quat => {
    const half = (deg * Math.PI) / 360;
    const q: Quat = [0, 0, 0, Math.cos(half)];
    q[i] = Math.sin(half);
    return q;
  };
  return mul(axis(2, -rz), mul(axis(1, -ry), axis(0, rx)));
}

function mul([ax, ay, az, aw]: Quat, [bx, by, bz, bw]: Quat): Quat {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotate([x, y, z]: Vec3, [qx, qy, qz, qw]: Quat): Vec3 {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

type Rect = [u: number, v: number, du: number, dv: number];

/**
 * 面の4隅。(tu, tv) = (0,0) (1,0) (1,1) (0,1) がテクスチャの左上・右上・右下・左下に対応する。
 * box UVの1番目の領域 (east) がキャラクターの右側面 (-X)、正面 (north) が+Z
 */
const FACES: Record<FaceName, { normal: Vec3; corner: (b: Box, tu: number, tv: number) => Vec3 }> =
  {
    north: { normal: [0, 0, 1], corner: (b, tu, tv) => [lerp(b.x, tu), lerp(b.y, 1 - tv), b.z[1]] },
    south: {
      normal: [0, 0, -1],
      corner: (b, tu, tv) => [lerp(b.x, 1 - tu), lerp(b.y, 1 - tv), b.z[0]],
    },
    east: { normal: [-1, 0, 0], corner: (b, tu, tv) => [b.x[0], lerp(b.y, 1 - tv), lerp(b.z, tu)] },
    west: {
      normal: [1, 0, 0],
      corner: (b, tu, tv) => [b.x[1], lerp(b.y, 1 - tv), lerp(b.z, 1 - tu)],
    },
    up: { normal: [0, 1, 0], corner: (b, tu, tv) => [lerp(b.x, tu), b.y[1], lerp(b.z, tv)] },
    down: {
      normal: [0, -1, 0],
      corner: (b, tu, tv) => [lerp(b.x, 1 - tu), b.y[0], lerp(b.z, 1 - tv)],
    },
  };

type Box = { x: Vec2; y: Vec2; z: Vec2 };

const lerp = ([a, b]: Vec2, t: number) => a + (b - a) * t;

/** box UVを面ごとのUVにする */
function boxUv([u, v]: Vec2, [w, h, d]: Vec3, mirror: boolean): Partial<Record<FaceName, Rect>> {
  const rects: Record<FaceName, Rect> = {
    east: [u, v + d, d, h],
    north: [u + d, v + d, w, h],
    west: [u + d + w, v + d, d, h],
    south: [u + 2 * d + w, v + d, w, h],
    up: [u + d, v, w, d],
    down: [u + d + w, v + d, w, -d],
  };
  if (!mirror) return rects;
  // 左右反転し、east/westを入れ替える
  const flip = ([ru, rv, du, dv]: Rect): Rect => [ru + du, rv, -du, dv];
  const mirrored = Object.fromEntries(
    Object.entries(rects).map(([face, rect]) => [face, flip(rect)]),
  ) as Record<FaceName, Rect>;
  [mirrored.east, mirrored.west] = [mirrored.west, mirrored.east];
  return mirrored;
}

function faceUvs(cube: Cube, size: Vec3, mirror: boolean): Partial<Record<FaceName, Rect>> {
  const uv = cube.uv ?? [0, 0];
  if (Array.isArray(uv)) return boxUv(uv, size, mirror);
  const [w, h, d] = size;
  const defaults: Record<FaceName, Vec2> = {
    north: [w, h],
    south: [w, h],
    east: [d, h],
    west: [d, h],
    up: [w, d],
    down: [w, d],
  };
  const rects: Partial<Record<FaceName, Rect>> = {};
  for (const face of Object.keys(FACES) as FaceName[]) {
    const f = uv[face];
    if (!f?.uv) continue;
    const [du, dv] = f.uv_size ?? defaults[face];
    rects[face] = [f.uv[0], f.uv[1], du, dv];
  }
  return rects;
}

/** cubeの面を追加する。頂点はboneのpivot (出力の座標) 基準 */
export function addCube(
  out: Primitive,
  cube: Cube,
  bone: Bone,
  pivot: Vec3,
  texture: { width: number; height: number },
) {
  if (!cube.origin || !cube.size) return;
  const [ox, oy, oz] = cube.origin;
  const size = cube.size;
  const [w, h, d] = size;
  const inflate = cube.inflate ?? bone.inflate ?? 0;
  const box: Box = {
    x: [ox - inflate, ox + w + inflate],
    y: [oy - inflate, oy + h + inflate],
    z: [-(oz + d) - inflate, -oz + inflate],
  };
  const rotation = toQuat(cube.rotation);
  const center = cube.pivot ? toOut(cube.pivot) : ([ox + w / 2, oy + h / 2, -(oz + d / 2)] as Vec3);

  const rects = faceUvs(cube, size, cube.mirror ?? bone.mirror ?? false);
  for (const [face, rect] of Object.entries(rects) as [FaceName, Rect][]) {
    const { normal, corner } = FACES[face];
    const corners = (
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as const
    ).map(([tu, tv]) => {
      let p = corner(box, tu, tv);
      if (rotation) {
        const r = rotate([p[0] - center[0], p[1] - center[1], p[2] - center[2]], rotation);
        p = [r[0] + center[0], r[1] + center[1], r[2] + center[2]];
      }
      const uv: Vec2 = [
        (rect[0] + rect[2] * tu) / texture.width,
        (rect[1] + rect[3] * tv) / texture.height,
      ];
      return { p: [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]] as Vec3, uv };
    });
    const n = rotation ? rotate(normal, rotation) : normal;
    // 左上→右上→右下は外から見て時計回りなので、反時計回りになるように並べる
    for (const i of [0, 2, 1, 0, 3, 2]) {
      out.positions.push(...corners[i]!.p);
      out.normals.push(...n);
      out.uvs.push(...corners[i]!.uv);
    }
  }
}

/** poly_meshの面を追加する。positionsはモデル座標の絶対位置で、UVは左下原点 */
export function addPolyMesh(
  out: Primitive,
  mesh: PolyMesh,
  pivot: Vec3,
  texture: { width: number; height: number },
) {
  const positions = mesh.positions ?? [];
  const normals = mesh.normals ?? [];
  const uvs = mesh.uvs ?? [];
  let polys: [number, number, number][][];
  if (mesh.polys === 'tri_list' || mesh.polys === 'quad_list') {
    // positions・normals・uvsが1対1で並んでいる
    const n = mesh.polys === 'tri_list' ? 3 : 4;
    polys = [];
    for (let i = 0; i + n <= positions.length; i += n) {
      polys.push(Array.from({ length: n }, (_, k) => [i + k, i + k, i + k]));
    }
  } else {
    polys = mesh.polys ?? [];
  }

  const [su, sv] = mesh.normalized_uvs ? [1, 1] : [texture.width, texture.height];
  for (const poly of polys) {
    const verts = poly.flatMap(([p, n, t]) => {
      const pos = positions[p];
      const uv = uvs[t];
      if (!pos || !uv) return [];
      const [x, y, z] = toOut(pos);
      return [
        {
          p: [x - pivot[0], y - pivot[1], z - pivot[2]],
          n: toOut(normals[n] ?? [0, 0, 0]),
          uv: [uv[0] / su, 1 - uv[1] / sv],
        },
      ];
    });
    if (verts.length !== poly.length || verts.length < 3) continue;
    // Zを反転すると裏返るので逆順にする
    const order = verts.length === 4 ? [0, 2, 1, 0, 3, 2] : [0, 2, 1];
    for (const i of order) {
      out.positions.push(...verts[i]!.p);
      out.normals.push(...verts[i]!.n);
      out.uvs.push(...verts[i]!.uv);
    }
  }
}
