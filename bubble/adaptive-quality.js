export const QUALITY_TIER_NAMES = ['high', 'balanced', 'low'];

export function createAdaptiveQuality({
  mobile,
  preview,
  maxDpr,
  minDpr,
  now = () => performance.now(),
  onChange = () => {},
} = {}) {
  let tier = 0;
  let currentMaxDpr = maxDpr;
  let currentMinDpr = minDpr;
  let dpr = maxDpr;
  let steps = preview ? 56 : mobile ? 64 : 88;
  let lastFps = null;
  let sampleStarted = now();
  let sampleFrames = 0;
  let lowSamples = 0;
  let highSamples = 0;

  function profile(nextTier) {
    const stepProfiles = mobile ? [64, 60, 56] : [88, 72, 60];
    const dprProfiles = [
      currentMaxDpr,
      Math.max(currentMinDpr, currentMaxDpr * 0.8),
      currentMinDpr,
    ];
    return { dpr: dprProfiles[nextTier], steps: stepProfiles[nextTier] };
  }

  function snapshot() {
    return {
      tier: QUALITY_TIER_NAMES[tier],
      tierIndex: tier,
      lastFps,
      dpr,
      maxDpr: currentMaxDpr,
      minDpr: currentMinDpr,
      steps,
    };
  }

  function setTier(nextTier) {
    const next = Math.max(0, Math.min(QUALITY_TIER_NAMES.length - 1, nextTier));
    const nextProfile = profile(next);
    const changed = tier !== next || dpr !== nextProfile.dpr || steps !== nextProfile.steps;
    tier = next;
    dpr = nextProfile.dpr;
    steps = nextProfile.steps;
    if (changed) onChange(snapshot());
    return snapshot();
  }

  function updateLimits(nextMaxDpr, nextMinDpr) {
    currentMaxDpr = nextMaxDpr;
    currentMinDpr = nextMinDpr;
    return setTier(tier);
  }

  function resetSamples(at = now(), clearFps = false) {
    sampleStarted = at;
    sampleFrames = 0;
    lowSamples = 0;
    highSamples = 0;
    if (clearFps) lastFps = null;
  }

  function sample(at, { blocked = false } = {}) {
    if (preview) return snapshot();
    if (blocked) {
      resetSamples(at);
      return snapshot();
    }
    sampleFrames++;
    const elapsed = at - sampleStarted;
    if (elapsed < 2000) return snapshot();
    if (elapsed > 5000) {
      resetSamples(at);
      return snapshot();
    }

    const fps = sampleFrames * 1000 / elapsed;
    lastFps = fps;
    sampleStarted = at;
    sampleFrames = 0;
    if (fps < 45) {
      lowSamples++;
      highSamples = 0;
      if (lowSamples >= 2 && tier < QUALITY_TIER_NAMES.length - 1) {
        lowSamples = 0;
        setTier(tier + 1);
      }
    } else if (fps > 56) {
      highSamples++;
      lowSamples = 0;
      if (highSamples >= 3 && tier > 0) {
        highSamples = 0;
        setTier(tier - 1);
      }
    } else {
      lowSamples = 0;
      highSamples = 0;
    }
    return snapshot();
  }

  return { snapshot, setTier, updateLimits, resetSamples, sample };
}
