import Module from 'manifold-3d';
import { axes, validateDesign } from './spec.js';

let kernel;
function getKernel(wasmUrl) {
  kernel ??= Module(wasmUrl ? { locateFile: () => wasmUrl } : {}).then(wasm => {
    wasm.setup();
    return wasm.Manifold;
  });
  return kernel;
}

const vector = value => axes.map(axis => value[axis]);

function primitive(Manifold, { kind, size }) {
  switch (kind) {
    case 'box': return Manifold.cube(vector(size), true);
    case 'cylinder': return Manifold.cylinder(size.z, size.x / 2, size.x / 2, 96, true);
    case 'cone': return Manifold.cylinder(size.z, size.x / 2, 0, 96, true);
    case 'sphere': return Manifold.sphere(size.x / 2, 64);
  }
}

export async function buildModel(input, wasmUrl) {
  const design = validateDesign(input);
  if (!design.features.length) throw new Error(design.summary);
  const Manifold = await getKernel(wasmUrl);
  const allocated = [];
  function keep(object) {
    allocated.push(object);
    return object;
  }
  try {
    let model;
    for (const feature of design.features) {
      const base = keep(primitive(Manifold, feature));
      const oriented = keep(base.rotate(vector(feature.rotation)));
      const placed = keep(oriented.translate(vector(feature.center)));
      if (!model) {
        model = placed;
        continue;
      }
      const next = keep(feature.action === 'cut' ? model.subtract(placed) : model.add(placed));
      const delta = Math.abs(next.volume() - model.volume());
      if (delta < 0.00001) throw new Error(`“${feature.label}” didn't change the solid. Check its position and dimensions.`);
      model = next;
    }
    if (model.isEmpty() || model.volume() <= 0) throw new Error('The features leave no printable solid.');
    const pieces = model.decompose();
    allocated.push(...pieces);
    if (pieces.length !== 1) throw new Error('The model has disconnected bodies. Adjust their positions so they overlap.');

    const { min, max } = model.boundingBox();
    const dimensions = max.map((value, index) => value - min[index]);
    if (dimensions.some(size => size < 0.2 || size > 500)) {
      throw new Error('The finished model must be between 0.2 and 500 mm on each axis.');
    }
    const seated = keep(model.translate([-0.5 * (min[0] + max[0]), -0.5 * (min[1] + max[1]), -min[2]]));
    const mesh = seated.getMesh();
    const positions = new Float32Array(3 * mesh.triVerts.length);
    for (let i = 0; i < mesh.triVerts.length; i++) {
      const start = mesh.triVerts[i] * mesh.numProp;
      positions.set(mesh.vertProperties.subarray(start, start + 3), i * 3);
    }
    return { design, dimensions, volume: model.volume(), triangles: positions.length / 9, positions };
  } finally {
    for (const object of allocated.reverse()) object.delete();
  }
}

export function encodeSTL({ positions, triangles }) {
  const buffer = new ArrayBuffer(84 + 50 * triangles);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode('PrintLab AI | coordinates in millimeters'));
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  for (let i = 0; i < triangles; i++) {
    const p = positions.subarray(i * 9, i * 9 + 9);
    const a = [p[3] - p[0], p[4] - p[1], p[5] - p[2]];
    const b = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
    const normal = [
      a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
    ];
    const length = Math.hypot(...normal) || 1;
    const offset = 84 + i * 50;
    for (let j = 0; j < 3; j++) view.setFloat32(offset + j * 4, normal[j] / length, true);
    for (let j = 0; j < 9; j++) view.setFloat32(offset + 12 + j * 4, p[j], true);
  }
  return buffer;
}
