import { encode } from 'fast-png';
import { skinToGlb } from './index.ts';

/** Loginパケットのclient data JWTのclaimsのうち、スキンに関係するもの */
export interface ClientData {
  /** RGBAの生データ (base64) */
  SkinData: string;
  SkinImageWidth: number;
  SkinImageHeight: number;
  /** geometryのJSON (base64) */
  SkinGeometryData?: string;
  /** resource patchのJSON (base64) */
  SkinResourcePatch?: string;
  ArmSize?: string;
  AnimatedImageData?: { Image: string; ImageWidth: number; ImageHeight: number }[];
  /** マントのRGBAの生データ (base64)。マントが無ければ空 */
  CapeData?: string;
  CapeImageWidth?: number;
  CapeImageHeight?: number;
}

/** client dataのclaimsをそのままGLBにする */
export function clientDataToGlb(clientData: ClientData): Uint8Array {
  const { CapeData, CapeImageWidth, CapeImageHeight } = clientData;
  return skinToGlb({
    cape:
      CapeData && CapeImageWidth && CapeImageHeight
        ? rgbaToPng(CapeData, CapeImageWidth, CapeImageHeight)
        : undefined,
    skin: rgbaToPng(clientData.SkinData, clientData.SkinImageWidth, clientData.SkinImageHeight),
    geometry: decodeJson(clientData.SkinGeometryData),
    resourcePatch: decodeJson(clientData.SkinResourcePatch),
    animatedImages: (clientData.AnimatedImageData ?? []).map((image) =>
      rgbaToPng(image.Image, image.ImageWidth, image.ImageHeight),
    ),
    armSize: clientData.ArmSize,
  });
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function rgbaToPng(base64: string, width: number, height: number): Uint8Array {
  const data = decodeBase64(base64);
  if (data.byteLength !== width * height * 4) {
    throw new Error(`expected ${width * height * 4} bytes for ${width}x${height} RGBA`);
  }
  return encode({ width, height, data, channels: 4 });
}

function decodeJson(base64: string | undefined): unknown {
  if (!base64) return undefined;
  return JSON.parse(new TextDecoder().decode(decodeBase64(base64)));
}
