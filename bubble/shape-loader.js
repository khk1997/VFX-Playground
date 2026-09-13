export function describeShapeImport({
  file,
  kind,
  svgVariant,
  gridSize,
  rebuilding,
  defaultSvgName,
  meltSvgName,
  defaultSolidName,
}) {
  const builtin = !file;
  const label = builtin
    ? (kind === 'svg' ? (svgVariant === 'ice' ? meltSvgName : defaultSvgName) : defaultSolidName)
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
  makeDefaultSvgFile,
  makeMeltDemoSvgFile,
  buildDefaultSolid,
}) {
  if (kind === 'svg') {
    const source = file || (svgVariant === 'ice' ? makeMeltDemoSvgFile() : makeDefaultSvgFile());
    return svgToField(source, { supersample: mobile ? 2 : 3 });
  }
  return file
    ? gltfToField(file, gridSize)
    : objectToField(buildDefaultSolid(), gridSize);
}
