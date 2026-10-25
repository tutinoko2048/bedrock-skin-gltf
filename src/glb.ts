/** glTF 2.0のJSONとバイナリをGLBにまとめる */

export interface GltfBuilder {
  json: Record<string, unknown[]> & { bufferViews: unknown[]; accessors: unknown[] };
  chunks: Uint8Array[];
  length: number;
}

export function createBuilder(): GltfBuilder {
  return { json: { bufferViews: [], accessors: [] }, chunks: [], length: 0 };
}

/** バイナリを追加してbufferViewの番号を返す */
export function addBufferView(b: GltfBuilder, data: Uint8Array): number {
  b.json.bufferViews.push({ buffer: 0, byteOffset: b.length, byteLength: data.byteLength });
  const padding = (4 - (data.byteLength % 4)) % 4;
  b.chunks.push(data, new Uint8Array(padding));
  b.length += data.byteLength + padding;
  return b.json.bufferViews.length - 1;
}

export function addFloatAccessor(
  b: GltfBuilder,
  values: number[],
  type: 'VEC2' | 'VEC3',
  withBounds = false,
): number {
  const n = type === 'VEC2' ? 2 : 3;
  const accessor: Record<string, unknown> = {
    bufferView: addBufferView(b, new Uint8Array(new Float32Array(values).buffer)),
    componentType: 5126,
    count: values.length / n,
    type,
  };
  if (withBounds) {
    // POSITIONはmin/maxが必須
    const min = Array<number>(n).fill(Infinity);
    const max = Array<number>(n).fill(-Infinity);
    values.forEach((v, i) => {
      const f = Math.fround(v);
      min[i % n] = Math.min(min[i % n]!, f);
      max[i % n] = Math.max(max[i % n]!, f);
    });
    Object.assign(accessor, { min, max });
  }
  b.json.accessors.push(accessor);
  return b.json.accessors.length - 1;
}

export function toGlb(b: GltfBuilder, json: Record<string, unknown>): Uint8Array {
  const encoder = new TextEncoder();
  const buffers = b.length > 0 ? [{ byteLength: b.length }] : [];
  const text = JSON.stringify({ ...json, ...b.json, buffers });
  const jsonPadding = (4 - (encoder.encode(text).byteLength % 4)) % 4;
  const jsonBytes = encoder.encode(text + ' '.repeat(jsonPadding));

  const total = 12 + 8 + jsonBytes.byteLength + (b.length > 0 ? 8 + b.length : 0);
  const glb = new Uint8Array(total);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  glb.set(jsonBytes, 20);
  if (b.length > 0) {
    let offset = 20 + jsonBytes.byteLength;
    view.setUint32(offset, b.length, true);
    view.setUint32(offset + 4, 0x004e4942, true); // "BIN\0"
    offset += 8;
    for (const chunk of b.chunks) {
      glb.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  return glb;
}
