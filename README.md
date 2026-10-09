# ODM Viz

Open LAS / LAZ point clouds and drone surveys in the browser: no install, no server, no upload.
Files are decoded locally by a Rust → WebAssembly decoder running in a Web Worker and rendered
with three.js / React Three Fiber.

<img width="2391" height="1172" alt="ODM Viz rendering a point cloud" src="https://github.com/user-attachments/assets/9416ba9a-8126-4ad5-87ca-f3e1ddc665a6" />

**Try it:** drop a `.las` / `.laz` file on the [demo](https://anwaraliahmad.github.io/odm-viz/),
load the bundled Autzen sample, or link straight to any CORS-enabled file with
`?url=https://…/cloud.laz`.

## Features

- **LAS 1.0–1.4, point formats 0–10, LAZ and COPC files** decoded with [`laz-rs`][laz-rs] (a pure
  Rust LASzip port) compiled to a ~60 kB (gzipped) WebAssembly module. No Emscripten, C++
  submodules or Docker.
- **Off the main thread.** Decoding runs in a Web Worker and the typed arrays are _transferred_
  back with zero copies. Loads report download and decode progress and can be aborted.
- **Survey-grade precision.** Real-world coordinates (UTM, state plane) are re-centred in
  float64 before conversion to float32, so points keep millimetre precision instead of
  snapping to a ~0.5 m grid.
- **Colour by RGB, elevation, intensity or ASPRS classification**, switched by a shader uniform
  without rebuilding geometry. Ramps are outlier-robust (percentile-based).
- **Point budget.** Large files are evenly decimated across the whole extent instead of being
  truncated.
- Selective LAZ decompression: for LAS 1.4 layered formats (6–10), layers the viewer never
  reads (GPS time, scan angle, extra bytes…) are skipped.

## Packages

| Package                          | What it is                                                                 |
| :------------------------------- | :------------------------------------------------------------------------- |
| [`@odm-viz/las`](packages/las)   | LAS/LAZ decoder: Rust core (`rust/`), wasm-bindgen glue, Web Worker client |
| [`@odm-viz/r3f`](packages/r3f)   | `usePointCloud` hook + `<PointCloud>` component for React Three Fiber      |
| [`@odm-viz/core`](packages/core) | Framework-free helpers: ASPRS classification table, ODM shot parsing       |
| [`apps/demo`](apps/demo)         | The viewer app (Vite)                                                      |

```tsx
import { Canvas } from '@react-three/fiber';
import { PointCloud, usePointCloud } from '@odm-viz/r3f';

function Viewer({ url }: { url: string }) {
  const state = usePointCloud(url, { maxPoints: 4_000_000 });
  return (
    <Canvas>
      {state.status === 'ready' && <PointCloud cloud={state.cloud} colorMode="elevation" />}
    </Canvas>
  );
}
```

## Development

Prerequisites: Node 22+ with Corepack (`corepack enable`), a Rust toolchain via
[rustup](https://rustup.rs) (the `wasm32-unknown-unknown` target is installed automatically
from `rust-toolchain.toml`), and `wasm-bindgen-cli` matching the crate's version:

```bash
cargo install wasm-bindgen-cli --version 0.2.129
pnpm install
pnpm build        # wasm + all packages + demo
pnpm dev          # demo at http://localhost:5173
```

| Command          | Does                                                   |
| :--------------- | :----------------------------------------------------- |
| `pnpm test`      | Vitest suites (decoder runs against real wasm in Node) |
| `pnpm test:rust` | Rust tests: LAS/LAZ round-trips for formats 0, 3 and 7 |
| `pnpm typecheck` | `tsc --noEmit` in every package                        |
| `pnpm lint`      | ESLint (flat config) · `pnpm format` for Prettier      |
| `pnpm changeset` | Record a change for the next release                   |

To check the decoder against a real file:
`ODM_VIZ_SAMPLE=path/to/file.laz cargo test --release --manifest-path packages/las/rust/Cargo.toml -- --ignored --nocapture`

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (enforced by
commitlint); releases are managed with [Changesets](https://github.com/changesets/changesets).

## Roadmap

- [x] **Revive**: Rust/WASM decoder, worker pipeline, precision fixes, React 19 / R3F 9 / Vite 8,
      tests, CI, GitHub Pages demo
- [ ] **Stream**: COPC hierarchy + HTTP range requests, octree LOD by screen-space error, so
      only the visible detail is ever downloaded
- [ ] **WebGPU renderer**: compute-shader point rasterisation + eye-dome lighting, WebGL2 fallback
- [ ] **ODM features**: camera poses and photo thumbnails, measurements, orthophoto drape,
      Gaussian splats

## License

MIT. The WebAssembly module includes [`laz-rs`][laz-rs] (Apache-2.0); see [LICENSE.txt](LICENSE.txt).

[laz-rs]: https://github.com/tmontaigu/laz-rs
