# @odm-viz/las

LAS / LAZ point cloud decoding for the browser. A small Rust core built on
[`laz-rs`](https://github.com/tmontaigu/laz-rs), compiled to WebAssembly with wasm-bindgen and
run in a Web Worker.

```ts
import { LasWorker } from '@odm-viz/las';

const worker = new LasWorker();
const buffer = await (await fetch(url)).arrayBuffer();
const cloud = await worker.decode(buffer, {
  maxPoints: 4_000_000,
  onProgress: (done, total) => console.log(`${done}/${total}`),
});

// Positions are float32 offsets from a float64 origin, which keeps UTM-scale
// coordinates precise.
cloud.origin; // [x, y, z] world
cloud.positions; // Float32Array xyz, relative to origin
cloud.colors; // Uint8Array rgb | null
cloud.intensity; // Uint16Array
cloud.classification; // Uint8Array (ASPRS codes)
```

`decodeLas()` and `readHeader()` are also exported for synchronous use (call `await init()`
first; in Node pass the `.wasm` bytes to `init`).

Supports LAS 1.0–1.4, point formats 0–10, LAZ (including variable-size chunks and LAS 1.4
layered compression) and COPC files read as whole files.
