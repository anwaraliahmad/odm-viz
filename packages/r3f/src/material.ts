import * as THREE from 'three';
import { classificationLut } from '@odm-viz/core';

export type ColorMode = 'rgb' | 'elevation' | 'intensity' | 'classification' | 'solid';
export type Ramp = 'turbo' | 'viridis' | 'grayscale';

const MODES: Record<ColorMode, number> = {
  rgb: 0,
  elevation: 1,
  intensity: 2,
  classification: 3,
  solid: 4,
};
const RAMPS: Record<Ramp, number> = { turbo: 0, viridis: 1, grayscale: 2 };

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float intensity;
  attribute float classification;

  uniform int uMode;
  uniform int uRamp;
  uniform float uPointSize;
  uniform vec2 uZRange;
  uniform vec2 uIntensityRange;
  uniform vec3 uSolid;
  uniform sampler2D uClassLut;

  varying vec3 vColor;

  // Polynomial fits by Google (Turbo) and mattz (viridis): no texture lookups needed.
  vec3 turbo(float t) {
    const vec4 kr = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
    const vec4 kg = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
    const vec4 kb = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
    const vec2 kr2 = vec2(-152.94239396, 59.28637943);
    const vec2 kg2 = vec2(4.27729857, 2.82956604);
    const vec2 kb2 = vec2(-89.90310912, 27.34824973);
    vec4 v4 = vec4(1.0, t, t * t, t * t * t);
    vec2 v2 = v4.zw * v4.z;
    return vec3(dot(v4, kr) + dot(v2, kr2), dot(v4, kg) + dot(v2, kg2), dot(v4, kb) + dot(v2, kb2));
  }

  vec3 viridis(float t) {
    const vec3 c0 = vec3(0.2777273272234177, 0.005407344544966578, 0.3340998053353061);
    const vec3 c1 = vec3(0.1050930431085774, 1.404613529898575, 1.384590162594685);
    const vec3 c2 = vec3(-0.3308618287255563, 0.214847559468213, 0.09509516302823659);
    const vec3 c3 = vec3(-4.634230498983486, -5.799100973351585, -19.33244095627987);
    const vec3 c4 = vec3(6.228269936347081, 14.17993336680509, 56.69055260068105);
    const vec3 c5 = vec3(4.776384997670288, -13.74514537774601, -65.35303263337234);
    const vec3 c6 = vec3(-5.435455855934631, 4.645852612178535, 26.3124352495832);
    return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
  }

  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0);
    if (uRamp == 0) return turbo(t);
    if (uRamp == 1) return viridis(t);
    return vec3(t);
  }

  void main() {
    if (uMode == 0) vColor = color;
    else if (uMode == 1) vColor = ramp((position.z - uZRange.x) / (uZRange.y - uZRange.x));
    else if (uMode == 2) vColor = ramp((intensity - uIntensityRange.x) / (uIntensityRange.y - uIntensityRange.x));
    else if (uMode == 3) vColor = texture2D(uClassLut, vec2((classification + 0.5) / 256.0, 0.5)).rgb;
    else vColor = uSolid;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uPointSize;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;

  void main() {
    // Round splats: discard the corners of the point sprite.
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    if (dot(c, c) > 1.0) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

export interface PointCloudMaterialParams {
  colorMode?: ColorMode;
  ramp?: Ramp;
  /** Point diameter in device pixels */
  pointSize?: number;
  /** Elevation range (local z) mapped onto the ramp */
  zRange?: [number, number];
  /** Intensity range, normalised 0–1 (uint16 / 65535) */
  intensityRange?: [number, number];
  solidColor?: THREE.ColorRepresentation;
}

/**
 * Point material that switches colouring with a uniform instead of rebuilding geometry.
 * Colours are written as-is (already sRGB), so no colour-space conversion is applied.
 */
export class PointCloudMaterial extends THREE.ShaderMaterial {
  readonly #lut: THREE.DataTexture;

  constructor(params: PointCloudMaterialParams = {}) {
    const lutData = classificationLut();
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgba.set(lutData.subarray(i * 3, i * 3 + 3), i * 4);
      rgba[i * 4 + 3] = 255;
    }
    const lut = new THREE.DataTexture(rgba, 256, 1, THREE.RGBAFormat);
    lut.needsUpdate = true;

    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMode: { value: 0 },
        uRamp: { value: 0 },
        uPointSize: { value: 2 },
        uZRange: { value: new THREE.Vector2(0, 1) },
        uIntensityRange: { value: new THREE.Vector2(0, 1) },
        uSolid: { value: new THREE.Color() },
        uClassLut: { value: lut },
      },
    });
    this.#lut = lut;
    this.set(params);
  }

  set(p: PointCloudMaterialParams) {
    const u = this.uniforms;
    if (p.colorMode !== undefined) u.uMode.value = MODES[p.colorMode];
    if (p.ramp !== undefined) u.uRamp.value = RAMPS[p.ramp];
    if (p.pointSize !== undefined) u.uPointSize.value = p.pointSize;
    if (p.zRange)
      u.uZRange.value.set(p.zRange[0], p.zRange[1] > p.zRange[0] ? p.zRange[1] : p.zRange[0] + 1);
    if (p.intensityRange) {
      const [lo, hi] = p.intensityRange;
      u.uIntensityRange.value.set(lo, hi > lo ? hi : lo + 1e-3);
    }
    if (p.solidColor !== undefined) (u.uSolid.value as THREE.Color).set(p.solidColor);
  }

  override dispose() {
    this.#lut.dispose();
    super.dispose();
  }
}
