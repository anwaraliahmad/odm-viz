import * as THREE from 'three';
import type { DecodedPointCloud } from '@odm-viz/las';

/**
 * Wrap decoded buffers in a BufferGeometry without copying them. Positions are local to
 * `cloud.origin` (z-up, as in LAS); bounds come from the decoder so no extra pass is needed.
 */
export function createPointCloudGeometry(cloud: DecodedPointCloud): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = cloud.pointCount;
  g.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
  // Shader reads `color` even in other modes; give colourless clouds a constant white.
  g.setAttribute(
    'color',
    cloud.colors
      ? new THREE.BufferAttribute(cloud.colors, 3, true)
      : new THREE.BufferAttribute(new Uint8Array(n * 3).fill(255), 3, true)
  );
  g.setAttribute('intensity', new THREE.BufferAttribute(cloud.intensity, 1, true));
  g.setAttribute('classification', new THREE.BufferAttribute(cloud.classification, 1, false));

  const [x0, y0, z0, x1, y1, z1] = cloud.bounds;
  const [ox, oy, oz] = cloud.origin;
  g.boundingBox = new THREE.Box3(
    new THREE.Vector3(x0 - ox, y0 - oy, z0 - oz),
    new THREE.Vector3(x1 - ox, y1 - oy, z1 - oz)
  );
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

/**
 * Robust [lo, hi] of a typed array via a fixed-size sample: percentiles rather than
 * min/max so a few outliers (noise, saturated returns) don't flatten the colour ramp.
 */
export function percentileRange(
  values: ArrayLike<number>,
  lowPct = 0.02,
  highPct = 0.98,
  stride = 1,
  offset = 0,
  sampleSize = 20_000
): [number, number] {
  const count = Math.floor((values.length - offset + stride - 1) / stride);
  if (count <= 0) return [0, 1];
  const step = Math.max(1, Math.floor(count / sampleSize));
  const sample: number[] = [];
  for (let i = 0; i < count; i += step) sample.push(values[offset + i * stride]);
  sample.sort((a, b) => a - b);
  const at = (p: number) => sample[Math.min(sample.length - 1, Math.floor(p * sample.length))];
  return [at(lowPct), at(highPct)];
}
