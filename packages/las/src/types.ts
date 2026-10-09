export type Vec3 = [x: number, y: number, z: number];

/** [minX, minY, minZ, maxX, maxY, maxZ] */
export type Bounds = [number, number, number, number, number, number];

export interface LasHeaderInfo {
  /** LAS version, e.g. "1.4" */
  version: string;
  /** Point data record format, 0–10 */
  pointFormat: number;
  /** Number of points in the file */
  pointCount: number;
  /** LAZ (LASzip-compressed) rather than plain LAS */
  isCompressed: boolean;
  /** Cloud Optimized Point Cloud (has a COPC info VLR) */
  isCopc: boolean;
  /** Point format carries RGB */
  hasColor: boolean;
  scale: Vec3;
  offset: Vec3;
  /** Bounds as written in the header, world coordinates */
  bounds: Bounds;
}

export interface DecodeOptions {
  /** Keep every n-th point. Default 1 (all points). */
  stride?: number;
  /** Cap on decoded points; raises `stride` so the whole extent is still covered. 0 = no cap. */
  maxPoints?: number;
  /** Decode RGB if the file has it. Default true. */
  colors?: boolean;
  /** Called once per decoded batch with (pointsProcessed, totalPoints). */
  onProgress?: (done: number, total: number) => void;
}

export interface DecodedPointCloud {
  header: LasHeaderInfo;
  /** Number of points decoded (after stride) */
  pointCount: number;
  /** Stride actually applied */
  stride: number;
  /**
   * World coordinate that `positions` are relative to. Keeping this in float64 and the
   * per-point offsets in float32 preserves millimetre precision for UTM-scale coordinates.
   */
  origin: Vec3;
  /** Bounds of the decoded points, world coordinates */
  bounds: Bounds;
  /** xyz triplets relative to `origin` */
  positions: Float32Array;
  /** 8-bit rgb triplets, or null when absent / not requested */
  colors: Uint8Array | null;
  intensity: Uint16Array;
  /** ASPRS classification codes */
  classification: Uint8Array;
  /** Wall-clock decode time in ms (excludes fetching) */
  decodeMs: number;
}

/** The typed arrays of a cloud, for postMessage transfer lists. */
export function transferablesOf(cloud: DecodedPointCloud): ArrayBuffer[] {
  const arrays = [cloud.positions, cloud.colors, cloud.intensity, cloud.classification];
  return arrays.filter((a) => a !== null).map((a) => a.buffer as ArrayBuffer);
}
