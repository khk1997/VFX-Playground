'use strict';

export const TAU = Math.PI * 2;
export const set = (out, x, y, z, radiusFactor = 1, shape = null) => {
  out.x = x; out.y = y; out.z = z; out.radiusFactor = radiusFactor;
  out.shape = shape;
  return out;
};

export const poolOf = context => context.surfaceAnchors.length
  ? context.surfaceAnchors : context.anchors;

export const anchorOf = (context, index) => {
  const pool = poolOf(context);
  return pool.length ? pool[index % pool.length] : context.center;
};

export function radialOf(point, center, out = { x: 1, y: 0, z: 0 }) {
  const x = point.x - center.x;
  const y = point.y - center.y;
  const z = point.z - center.z;
  const length = Math.max(0.0001, Math.hypot(x, y, z));
  out.x = x / length; out.y = y / length; out.z = z / length;
  return out;
}
