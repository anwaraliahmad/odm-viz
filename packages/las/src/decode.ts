import initWasm, {
  decode as wasmDecode,
  readHeader as wasmReadHeader,
  type InitInput,
  type LasHeader,
} from '../pkg/odm_viz_las.js';
import type { Bounds, DecodeOptions, DecodedPointCloud, LasHeaderInfo, Vec3 } from './types.js';

let ready: Promise<void> | null = null;

/**
 * Load and instantiate the WebAssembly module. Idempotent. In browsers and bundlers the
 * `.wasm` file is located automatically; in Node pass its bytes.
 */
export function init(wasm?: InitInput | Promise<InitInput>): Promise<void> {
  ready ??= initWasm(wasm === undefined ? undefined : { module_or_path: wasm }).then(
    () => undefined,
    (err: unknown) => {
      ready = null;
      throw err;
    }
  );
  return ready;
}

function headerInfo(h: LasHeader): LasHeaderInfo {
  const info: LasHeaderInfo = {
    version: h.version,
    pointFormat: h.pointFormat,
    pointCount: h.pointCount,
    isCompressed: h.isCompressed,
    isCopc: h.isCopc,
    hasColor: h.hasColor,
    scale: Array.from(h.scale) as Vec3,
    offset: Array.from(h.offset) as Vec3,
    bounds: Array.from(h.bounds) as Bounds,
  };
  h.free();
  return info;
}

/** Parse the LAS header and VLRs. Requires `init()` to have resolved. */
export function readHeader(bytes: Uint8Array): LasHeaderInfo {
  return headerInfo(wasmReadHeader(bytes));
}

/**
 * Decode a LAS/LAZ file synchronously on the calling thread. Requires `init()` to have
 * resolved. Prefer {@link LasWorker} in UI code so large files don't block rendering.
 */
export function decodeLas(bytes: Uint8Array, options: DecodeOptions = {}): DecodedPointCloud {
  const { stride = 1, maxPoints = 0, colors = true, onProgress } = options;
  const t0 = performance.now();
  const pc = wasmDecode(bytes, Math.max(1, stride | 0), maxPoints, colors, onProgress);
  try {
    return {
      header: headerInfo(pc.header),
      pointCount: pc.pointCount,
      stride: pc.stride,
      origin: Array.from(pc.origin) as Vec3,
      bounds: Array.from(pc.bounds) as Bounds,
      positions: pc.positions,
      colors: pc.colors ?? null,
      intensity: pc.intensity,
      classification: pc.classification,
      decodeMs: performance.now() - t0,
    };
  } finally {
    pc.free();
  }
}
