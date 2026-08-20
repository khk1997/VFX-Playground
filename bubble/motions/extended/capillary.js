'use strict';
import { TAU, anchorOf, radialOf, set } from './util.js';

export const CAPILLARY_AMPLITUDE_SCALE = 0.16;
export const CAPILLARY_MAX_SURFACE_SLOPE = 2.4;

export function effectiveCapillaryHeight(height, density) {
  const safeDensity = Math.max(1, Math.abs(density));
  const safeHeight = CAPILLARY_MAX_SURFACE_SLOPE
    / (safeDensity * TAU * CAPILLARY_AMPLITUDE_SCALE);
  return Math.min(height, safeHeight);
}

export default function sampleCapillary(i, phase, count, seed, P, context, out) {
  const anchor = anchorOf(context, i);
  const radial = radialOf(anchor, context.center);
  const distance = Math.hypot(anchor.x - context.center.x, anchor.y - context.center.y);
  const wave = Math.sin(TAU * (phase * P.capillarySpeed - distance * P.capillaryRings));
  const lift = wave * P.capillaryHeight * (0.38 + seed.h2 * 0.32);
  return set(out,
    anchor.x + radial.x * lift,
    anchor.y + radial.y * lift,
    anchor.z + radial.z * lift,
    (anchor.radiusHint || P.radius) / Math.max(P.radius, 0.001) * (0.48 + Math.abs(wave) * 0.2),
    { axis: [radial.x, radial.y, radial.z], stretch: 1 + Math.abs(lift) * 1.2 });
}
