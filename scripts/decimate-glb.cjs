const { NodeIO } = require('@gltf-transform/core');
const { simplify, weld, dedup, prune } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');

function tris(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      t += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
    }
  return Math.round(t);
}

(async () => {
  const io = new NodeIO();
  await MeshoptSimplifier.ready;
  const ratio = parseFloat(process.argv[2]);
  for (const f of process.argv.slice(3)) {
    const doc = await io.read(f);
    const before = tris(doc);
    // These models are flat-shaded (unique verts per face) so nothing welds and
    // the simplifier has no shared edges to collapse. The runtime material uses
    // flatShading, so per-vertex normals are ignored — drop every attribute but
    // POSITION, then weld by position to build real topology, then simplify.
    for (const m of doc.getRoot().listMeshes())
      for (const p of m.listPrimitives())
        for (const sem of p.listSemantics())
          if (sem !== 'POSITION') p.setAttribute(sem, null);
    await doc.transform(
      dedup(),
      weld({ tolerance: 0.0001 }),
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false }),
      prune(),
    );
    await io.write(f, doc);
    console.log(`${f.split('/').pop().padEnd(20)} ${before} -> ${tris(doc)} tris`);
  }
})();
