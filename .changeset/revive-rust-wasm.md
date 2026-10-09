---
'@odm-viz/las': minor
'@odm-viz/r3f': minor
'@odm-viz/core': minor
---

Revive the project on a modern stack.

- `@odm-viz/las` (was `@odm-viz/wasm`): new pure-Rust LAS/LAZ decoder (laz-rs + wasm-bindgen)
  replacing the Emscripten/LASzip build. Supports point formats 0–10, decodes in a Web Worker
  with transferable buffers, keeps float64 precision via a per-cloud origin, and offers
  stride/point-budget decimation. Fixes an RGB heap overflow, an invalid `free`, and
  half-coloured clouds in the old decoder.
- `@odm-viz/r3f` (was `@odm-viz/laz-loader`): `usePointCloud` hook and `<PointCloud>`
  component with RGB / elevation / intensity / classification colouring. Requires React 19
  and React Three Fiber 9.
- `@odm-viz/core`: ASPRS classification table and lookup texture; `parseShots` is now synchronous.
