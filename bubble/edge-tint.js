// Separate palettes share only their schema and sampler, never mutable state.
export const EDGE_TINT_TARGETS = ['researchShell', 'researchIcon'];
export const EDGE_TINT_STOPS = [
  { color: '#1265ed', position: 0 },
  { color: '#22c4ee', position: 0.16 },
  { color: '#eb8cce', position: 0.26 },
  { color: '#ffe29a', position: 0.32 },
  { color: '#b5eaf3', position: 0.52 },
  { color: '#bd83db', position: 0.76 },
];

export function edgeTintKeys(prefix) {
  return [`${prefix}Tint`, `${prefix}TintEdge`, `${prefix}TintColor`, ...edgeTintParams(prefix).map(p => p.key)];
}

// Validate imported per-backdrop memory against the existing control schema.
export function sanitizeEdgeTintValue(key, value) {
  const prefix = EDGE_TINT_TARGETS.find(p => edgeTintKeys(p).includes(key));
  if (!prefix) return undefined;
  if (key === `${prefix}TintColor` || key.includes('TintStopColor')) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
  }
  if (key === `${prefix}MultiTint`) return typeof value === 'boolean' ? value : undefined;
  const param = edgeTintParams(prefix).find(p => p.key === key) || { min: 0, max: 1 };
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(param.min, Math.min(param.max, value));
}

export function edgeTintParams(prefix) {
  return [
    { key: `${prefix}MultiTint`, label: '多色邊界', type: 'toggle', value: false },
    { key: `${prefix}MultiTintStrength`, label: '多色混合', min: 0, max: 1, step: 0.01, value: 1 },
    { key: `${prefix}MultiTintRotation`, label: '色彩旋轉 °', min: 0, max: 360, step: 1, value: 0 },
    { key: `${prefix}MultiTintFocus`, label: '折射聚色', min: 0, max: 1, step: 0.01, value: 0.35 },
    ...EDGE_TINT_STOPS.flatMap((stop, i) => [
      { key: `${prefix}TintStopColor${i}`, label: `色標 ${i + 1}`, type: 'color', value: stop.color, tintPalette: prefix },
      { key: `${prefix}TintStopPos${i}`, label: `位置 ${i + 1}`, min: 0, max: 0.99, step: 0.01, value: stop.position, tintPalette: prefix },
    ]),
  ];
}

export function readEdgeTintStops(params, prefix) {
  // Last stop wins at identical positions; no zero-length interpolation interval.
  const positions = new Map();
  EDGE_TINT_STOPS.forEach((fallback, i) => {
    const value = Number(params[`${prefix}TintStopPos${i}`] ?? fallback.position);
    const p = Number.isFinite(value) ? Math.min(0.99, Math.max(0, value)) : fallback.position;
    const hex = params[`${prefix}TintStopColor${i}`] ?? fallback.color;
    const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback.color;
    positions.set(p, { p, rgb: [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)) });
  });
  return [...positions.values()].sort((a, b) => a.p - b.p);
}

export function sampleEdgeTint(stops, phase) {
  const t = ((phase % 1) + 1) % 1;
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i], b = stops[(i + 1) % stops.length];
    const end = b.p + (i === stops.length - 1 ? 1 : 0);
    const at = t < a.p && i === stops.length - 1 ? t + 1 : t;
    if (at >= a.p && at <= end) {
      const f = (at - a.p) / (end - a.p);
      return a.rgb.map((v, channel) => v + (b.rgb[channel] - v) * f);
    }
  }
  return stops[0].rgb;
}
