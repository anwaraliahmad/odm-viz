import { describe, expect, it } from 'vitest';
import type { DecodedPointCloud } from '@odm-viz/las';
import { createPointCloudGeometry, percentileRange } from '../src/geometry.js';
import { PointCloudMaterial } from '../src/material.js';

const cloud = (n: number, colors: boolean): DecodedPointCloud => ({
  header: {
    version: '1.4',
    pointFormat: colors ? 3 : 0,
    pointCount: n,
    isCompressed: true,
    isCopc: false,
    hasColor: colors,
    scale: [0.01, 0.01, 0.01],
    offset: [0, 0, 0],
    bounds: [500_000, 4_000_000, 0, 500_010, 4_000_010, 5],
  },
  pointCount: n,
  stride: 1,
  origin: [500_005, 4_000_005, 2],
  bounds: [500_000, 4_000_000, 0, 500_010, 4_000_010, 5],
  positions: new Float32Array(n * 3).map((_, i) => i % 3),
  colors: colors ? new Uint8Array(n * 3) : null,
  intensity: new Uint16Array(n),
  classification: new Uint8Array(n),
  decodeMs: 0,
});

describe('createPointCloudGeometry', () => {
  it('sets attributes and local bounds without scanning points', () => {
    const g = createPointCloudGeometry(cloud(10, true));
    expect(g.getAttribute('position').count).toBe(10);
    expect(g.getAttribute('color').normalized).toBe(true);
    expect(g.getAttribute('intensity').normalized).toBe(true);
    expect(g.getAttribute('classification').normalized).toBe(false);
    expect(g.boundingBox!.min.toArray()).toEqual([-5, -5, -2]);
    expect(g.boundingBox!.max.toArray()).toEqual([5, 5, 3]);
  });

  it('fills white colours for colourless clouds', () => {
    const color = createPointCloudGeometry(cloud(4, false)).getAttribute('color');
    expect(Array.from(color.array)).toEqual(new Array(12).fill(255));
  });
});

describe('percentileRange', () => {
  it('ignores outliers', () => {
    const v = Float32Array.from({ length: 1000 }, (_, i) => i);
    v[0] = -1e9;
    v[999] = 1e9;
    const [lo, hi] = percentileRange(v, 0.02, 0.98);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1000);
  });

  it('reads one component of interleaved data', () => {
    const xyz = Float32Array.from([0, 0, 10, 0, 0, 20, 0, 0, 30]);
    expect(percentileRange(xyz, 0, 1, 3, 2)).toEqual([10, 30]);
  });
});

describe('PointCloudMaterial', () => {
  it('maps params onto uniforms', () => {
    const m = new PointCloudMaterial({
      colorMode: 'classification',
      ramp: 'viridis',
      zRange: [3, 3],
    });
    expect(m.uniforms.uMode.value).toBe(3);
    expect(m.uniforms.uRamp.value).toBe(1);
    // Degenerate ranges are widened to avoid a divide-by-zero in the shader.
    expect(m.uniforms.uZRange.value.toArray()).toEqual([3, 4]);
    m.dispose();
  });
});
