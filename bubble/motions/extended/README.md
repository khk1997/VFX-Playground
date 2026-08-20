# Extended motion modules

Each file exports one pure sampler with this signature:

`sample(index, phase, count, seed, parameters, shapeContext, output)`

`shapeContext` contains the current SVG/GLB primary anchors, surface anchors, centre, and radius.
The sampler writes `x`, `y`, `z`, `radiusFactor`, and optionally `shape` into `output`.
It must be deterministic and return the same visible state at `phase = 0` and `phase = 1`.

To remove a mode:

1. Delete its entry from `motions/registry.js`.
2. Delete its option from `bubble/index.html`.
3. Remove its import and `SAMPLERS` entry from `extended/index.js`.
4. Delete the sampler file and its name from `tests/extended_motions.mjs`.

No branch in `bubble.js` needs to change. Mode-specific sliders are generated from the registry's
`params` metadata and disappear automatically with the registry entry.
