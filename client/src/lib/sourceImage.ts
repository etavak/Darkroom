import { uploadSourceApi, uploadSourceFromGalleryApi } from '@/lib/api';
import type { SourceImageState } from '@/types/generation';

export function roundToMultiple(n: number, multiple: number): number {
  const m = Math.max(1, multiple);
  return Math.max(m, Math.round(n / m) * m);
}

/** Match source dims, rounded to family size multiple. */
export function matchSourceSize(
  srcW: number,
  srcH: number,
  multiple: number,
): { width: number; height: number } {
  return {
    width: roundToMultiple(srcW, multiple),
    height: roundToMultiple(srcH, multiple),
  };
}

/** Compute outpaint pads to reach a target aspect (e.g. "16:9") from source size. */
export function padsForAspect(
  srcW: number,
  srcH: number,
  aspect: string,
): { left: number; right: number; top: number; bottom: number } | null {
  const m = aspect.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const aw = Number(m[1]);
  const ah = Number(m[2]);
  if (!(aw > 0 && ah > 0)) return null;
  const targetRatio = aw / ah;
  const srcRatio = srcW / srcH;
  if (Math.abs(targetRatio - srcRatio) < 0.001) {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  if (targetRatio > srcRatio) {
    const targetW = Math.round(srcH * targetRatio);
    const pad = Math.max(0, targetW - srcW);
    const left = Math.floor(pad / 2);
    return { left, right: pad - left, top: 0, bottom: 0 };
  }
  const targetH = Math.round(srcW / targetRatio);
  const pad = Math.max(0, targetH - srcH);
  const top = Math.floor(pad / 2);
  return { left: 0, right: 0, top, bottom: pad - top };
}

export async function uploadFileAsSource(file: File): Promise<SourceImageState> {
  const res = await uploadSourceApi(file);
  return {
    previewUrl: res.url,
    comfyName: res.comfyName,
    localName: res.localName,
    width: res.width || 0,
    height: res.height || 0,
    parentId: null,
  };
}

export async function useGalleryAsSource(
  filename: string,
  parentId?: string | null,
): Promise<SourceImageState> {
  const res = await uploadSourceFromGalleryApi(filename);
  return {
    previewUrl: res.url,
    comfyName: res.comfyName,
    localName: res.localName,
    width: res.width || 0,
    height: res.height || 0,
    parentId: parentId ?? null,
  };
}
