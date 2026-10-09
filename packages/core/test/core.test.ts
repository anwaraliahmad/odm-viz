import { describe, expect, it } from 'vitest';
import { ASPRS_CLASSES, classificationLut, parseShots, sampleShots } from '../src/index.js';

describe('classificationLut', () => {
  it('maps ASPRS codes to rgb and falls back to white', () => {
    const lut = classificationLut();
    expect(lut).toHaveLength(768);
    expect(ASPRS_CLASSES[2].color).toBe('#a1734a');
    expect(Array.from(lut.subarray(6, 9))).toEqual([0xa1, 0x73, 0x4a]);
    expect(Array.from(lut.subarray(200 * 3, 201 * 3))).toEqual([255, 255, 255]);
  });
});

describe('shots', () => {
  const pose = { x: 1, y: 2, z: 3, omega: 0, phi: 0, kappa: 0, camera: 'c' };
  it('uses map keys as filenames when missing', () => {
    expect(parseShots({ 'a.jpg': pose, 'b.jpg': { ...pose, filename: 'B.JPG' } })).toEqual([
      { ...pose, filename: 'a.jpg' },
      { ...pose, filename: 'B.JPG' },
    ]);
  });
  it('samples every n-th shot', () => {
    const shots = parseShots(Object.fromEntries([...'abcdefg'].map((k) => [k, pose])));
    expect(sampleShots(shots, 3).map((s) => s.filename)).toEqual(['a', 'd', 'g']);
  });
});
