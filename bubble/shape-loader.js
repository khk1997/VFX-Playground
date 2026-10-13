export function describeShapeImport({
  file,
  kind,
  svgVariant,
  gridSize,
  rebuilding,
  builtinSvgName,
  defaultSolidName,
}) {
  const builtin = !file;
  const label = builtin
    ? (kind === 'svg' ? builtinSvgName(svgVariant) : defaultSolidName)
    : file.name;
  const status = kind === 'svg'
    ? `正在分析 SVG：${label}`
    : rebuilding
      ? `正在重新生成：${label} → ${gridSize}³（可能需要幾秒）`
      : `正在體素化模型：${label} → ${gridSize}³（可能需要幾秒）`;
  return { builtin, label, status };
}

export async function loadShapeAsset({
  file,
  kind,
  svgVariant,
  gridSize,
  mobile,
  svgToField,
  gltfToField,
  objectToField,
  makeBuiltinSvgFile,
  buildDefaultSolid,
}) {
  if (kind === 'svg') {
    const source = file || makeBuiltinSvgFile(svgVariant);
    return svgToField(source, { supersample: mobile ? 2 : 3 });
  }
  return file
    ? gltfToField(file, gridSize)
    : objectToField(buildDefaultSolid(), gridSize);
}
