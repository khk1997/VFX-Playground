'use strict';
import capillary from './capillary.js';
export { effectiveCapillaryHeight } from './capillary.js';

const SAMPLERS = { capillary };

export const isExtendedMotion = motion => Object.hasOwn(SAMPLERS, motion);

export function createExtendedMotionRuntime(P) {
  return {
    sample(motion, index, phase, count, seed, context, out) {
      const sampler = SAMPLERS[motion];
      if (!sampler) return null;
      return sampler(index, phase, count, seed, P, context, out);
    },
  };
}
