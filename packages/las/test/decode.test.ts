import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeLas, init, readHeader, transferablesOf } from '../src/index.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(here(`./fixtures/${name}`)));

// Mirrors `sample_points` in rust/tests/decode.rs, which generated the fixtures.
const SCALE = 0.001;
const OFFSET = [500_000, 4_000_000, 100];
const expected = (i: number) => ({
  world: [i * 7 - 3000, (i * 13) % 5000, (i * 3) % 997].map((v, a) => v * SCALE + OFFSET[a]),
  intensity: (i * 31) % 65535,
  classification: (i % 7) + 1,
});

beforeAll(async () => {
  await init(readFileSync(here('../pkg/odm_viz_las_bg.wasm')));
});

describe('readHeader', () => {
  it('reads LAZ header metadata', () => {
    const h = readHeader(fixture('fmt3.laz'));
    expect(h).toMatchObject({
      version: '1.4',
      pointFormat: 3,
      pointCount: 5000,
      isCompressed: true,
      isCopc: false,
      hasColor: true,
    });
    expect(h.offset).toEqual(OFFSET);
  });

  it('rejects non-LAS input', () => {
    expect(() => readHeader(new TextEncoder().encode('definitely not a point cloud'))).toThrow(
      /LASF/
    );
  });
});

describe('decodeLas', () => {
  it.each(['fmt3.laz', 'fmt0.las'])('decodes %s with float64-accurate positions', (name) => {
    const cloud = decodeLas(fixture(name));
    expect(cloud.pointCount).toBe(cloud.header.pointCount);
    expect(cloud.positions).toBeInstanceOf(Float32Array);
    for (const i of [0, 1, 999, cloud.pointCount - 1]) {
      const e = expected(i);
      for (let a = 0; a < 3; a++) {
        expect(cloud.origin[a] + cloud.positions[i * 3 + a]).toBeCloseTo(e.world[a], 3);
      }
      expect(cloud.intensity[i]).toBe(e.intensity);
      expect(cloud.classification[i]).toBe(e.classification);
    }
    expect(cloud.colors === null).toBe(!cloud.header.hasColor);
  });

  it('honours stride, maxPoints and progress', () => {
    const progress: number[] = [];
    const cloud = decodeLas(fixture('fmt3.laz'), {
      maxPoints: 1000,
      onProgress: (done) => progress.push(done),
    });
    expect(cloud.stride).toBe(5);
    expect(cloud.pointCount).toBe(1000);
    expect(cloud.intensity[10]).toBe(expected(50).intensity);
    expect(progress.at(-1)).toBe(5000);
  });

  it('can skip colours', () => {
    expect(decodeLas(fixture('fmt3.laz'), { colors: false }).colors).toBeNull();
  });

  it('lists every typed array as transferable', () => {
    const cloud = decodeLas(fixture('fmt3.laz'));
    expect(transferablesOf(cloud)).toHaveLength(4);
  });
});
