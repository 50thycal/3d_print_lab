import assert from 'node:assert/strict';
import test from 'node:test';
import { buildModel, encodeSTL } from '../src/geometry.js';
import { bracket } from '../src/spec.js';

function assertWatertight(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  assert.equal(buffer.byteLength, 84 + 50 * count);
  let lowestZ = Infinity;
  const edges = new Map();
  for (let face = 0; face < count; face++) {
    const offset = 84 + face * 50 + 12;
    const vertices = Array.from({ length: 3 }, (_, index) => {
      const coordinates = Array.from({ length: 3 }, (_, axis) => view.getFloat32(offset + index * 12 + axis * 4, true));
      assert.ok(coordinates.every(Number.isFinite));
      lowestZ = Math.min(lowestZ, coordinates[2]);
      return coordinates.join(',');
    });
    assert.equal(new Set(vertices).size, 3);
    for (let i = 0; i < 3; i++) {
      const first = vertices[i];
      const second = vertices[(i + 1) % 3];
      const key = [first, second].sort().join('|');
      const tally = edges.get(key) || { faces: 0, balance: 0 };
      tally.faces++;
      tally.balance += first < second ? 1 : -1;
      edges.set(key, tally);
    }
  }
  assert.equal(lowestZ, 0);
  assert.ok(edges.size > 0);
  assert.ok([...edges.values()].every(tally => tally.faces === 2 && tally.balance === 0));
}

test('exports a closed and correctly scaled bracket before and after a hole-spacing change', async () => {
  const initial = await buildModel(bracket);
  assert.deepEqual(initial.dimensions, [64, 34, 28]);
  const expectedVolume = 64 * 34 * 5 + 64 * 5 * 23 - 2 * Math.PI * 2.5 ** 2 * 5;
  assert.ok(Math.abs(initial.volume - expectedVolume) < 0.2);
  assertWatertight(encodeSTL(initial));

  const revision = structuredClone(bracket);
  revision.features[2].center.x += 3;
  revision.features[3].center.x -= 3;
  const edited = await buildModel(revision);
  assert.deepEqual(edited.dimensions, initial.dimensions);
  assert.ok(Math.abs(edited.volume - initial.volume) < 1e-6);
  assert.notDeepEqual(edited.positions, initial.positions);
  assertWatertight(encodeSTL(edited));
});

test('produces a through-hole after rotating a cutter 90 degrees', async () => {
  const plate = structuredClone(bracket);
  plate.features = [plate.features[0], plate.features[2]];
  Object.assign(plate.features[1], {
    center: { x: 0, y: 0, z: 2.5 },
    size: { x: 2, y: 2, z: 40 },
    rotation: { x: 90, y: 0, z: 0 },
  });
  const model = await buildModel(plate);
  assert.deepEqual(model.dimensions, [64, 34, 5]);
  assert.ok(Math.abs(model.volume - (64 * 34 * 5 - Math.PI * 34)) < 0.2);
  assertWatertight(encodeSTL(model));
});

test('rejects disconnected solids and cutters that do not touch the model', async () => {
  const disconnected = structuredClone(bracket);
  disconnected.features[1].center.y += 50;
  disconnected.features = disconnected.features.slice(0, 2);
  await assert.rejects(buildModel(disconnected), /disconnected bodies/);
  const missed = structuredClone(bracket);
  missed.features[2].center.x += 100;
  await assert.rejects(buildModel(missed), /didn't change the solid/);
});
