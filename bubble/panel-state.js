'use strict';

import { EDGE_TINT_TARGETS, edgeTintParams } from './edge-tint.js?v=dark-tint-1';
import { motionGates, usesShapeField } from './motions/registry.js?v=edge-tint-1';

export function createPanelStateController({
  params: P,
  staticUsesImportedShape,
  pageBackgroundCss,
  getDispersionMaster,
  refreshInspector,
}) {
  const gates = {
    ...motionGates(() => P.motion),
    shape: () => usesShapeField(P.motion) && staticUsesImportedShape(),
    svg: () => P.shapeSource === 'svg',
    glb: () => P.shapeSource !== 'svg',
    jellyPoke: () => P.jellyStyle === 'poke',
    jellyBounce: () => P.jellyStyle === 'bounce',
    capillaryTextureUI: () => P.motion === 'capillary' || P.motion === 'static',
    staticShapeBox: () => P.staticShape === 0,
    staticShapePrimitive: () => P.staticShape >= 1 && P.staticShape <= 6,
    staticShapeCylOrCone: () => P.staticShape === 4 || P.staticShape === 5,
    staticShapeTorus: () => P.staticShape === 6,
    staticShapeImport: () => P.staticShape === 7,
    capillaryTextureOn: () => Math.round(P.capillaryTexture) !== 6,
    bloomOn: () => P.bloomEnabled,
    streaksOn: () => P.streaksEnabled,
    causticBandUI: () => P.spectralCausticMapping !== 'filmNoise',
    researchTextureOn: () => Math.round(P.researchShellTexture) !== 6,
    researchBubblesOn: () => P.researchBubbles,
  };
  const borrowedRows = new Map();

  function gateOpen(spec) {
    return spec.trim().split(/\s+/).every(token => {
      const negated = token.startsWith('!');
      const gate = gates[negated ? token.slice(1) : token];
      return !gate || gate() !== negated;
    });
  }

  const setDisabled = (element, disabled) => {
    element.disabled = element.gateOff || disabled;
  };

  function applyGates() {
    const panel = document.getElementById('panel');
    panel.querySelectorAll('[data-gate]').forEach(element => {
      const open = gateOpen(element.dataset.gate)
        && !element.parentElement?.closest('.gated-off');
      element.classList.toggle('gated-off', !open);
    });
    panel.querySelectorAll('input, select, button').forEach(element => {
      element.gateOff = !!element.closest('.gated-off');
      element.disabled = element.gateOff;
    });
  }

  function syncBorrowedRows() {
    const wanted = new Map();
    document.querySelectorAll('#panel .borrowAnchor').forEach(anchor => {
      const block = anchor.closest('.modeBlock');
      if (block?.dataset.gate && !gateOpen(block.dataset.gate)) return;
      wanted.set(anchor.dataset.borrow, anchor);
    });
    const returning = [...borrowedRows.entries()]
      .filter(([key]) => !wanted.has(key))
      .sort((a, b) => a[1].order - b[1].order);
    for (const [key, state] of returning) {
      const before = state.next?.parentElement === state.parent ? state.next : null;
      state.parent.insertBefore(state.row, before);
      state.labelEl.textContent = state.label;
      borrowedRows.delete(key);
    }
    const leaving = new Set([...wanted.keys()].filter(key => !borrowedRows.has(key)));
    let order = 0;
    for (const [key, anchor] of wanted) {
      if (borrowedRows.has(key)) continue;
      const row = document.getElementById(key)?.closest('.row');
      const labelEl = row?.querySelector('label');
      if (!row || !labelEl) continue;
      const parent = row.parentElement;
      let next = row.nextElementSibling;
      while (next && leaving.has(next.querySelector('input, select')?.id)) {
        next = next.nextElementSibling;
      }
      borrowedRows.set(key, {
        row, parent, next, order: order++, label: labelEl.textContent, labelEl,
      });
      anchor.after(row);
      if (anchor.dataset.borrowLabel) labelEl.textContent = anchor.dataset.borrowLabel;
    }
  }

  function updateUIState() {
    syncBorrowedRows();
    applyGates();
    const setFeatureState = (id, enabled) => {
      const group = document.getElementById(id);
      if (!group) return;
      group.classList.toggle('is-disabled', !enabled);
      group.classList.add('featureGroup');
      group.querySelectorAll(
        '.row:not(.toggleRow):not(.keepEnabled) input,'
        + ' .row:not(.toggleRow):not(.keepEnabled) select,'
        + ' .row:not(.toggleRow):not(.keepEnabled) button',
      ).forEach(element => { setDisabled(element, !enabled); });
      group.querySelectorAll('.effectBlock input, .effectBlock select, .effectBlock button')
        .forEach(element => {
          if (!element.closest('.toggleRow') && !element.closest('.summaryToggle')) {
            setDisabled(element, !enabled);
          }
        });
    };
    const dispersionMaster = getDispersionMaster();
    setFeatureState('thinFilmGroup', P.filmEnabled);
    setFeatureState('artDispersionGroup', P.dispersionEnabled && dispersionMaster);
    setFeatureState('rayDispersionGroup', P.rayDispersionEnabled && dispersionMaster);
    setFeatureState('spectralCausticGroup', P.spectralCausticEnabled && dispersionMaster);
    document.getElementById('dispersionMaster').checked = dispersionMaster;
    document.getElementById('dispersionGroup').classList.toggle('is-disabled', !dispersionMaster);

    const rampGroup = document.getElementById('rampGroup');
    const rampDisabled = P.colorMode === 'spectral' || !P.filmEnabled;
    rampGroup.classList.toggle('is-disabled', rampDisabled);
    rampGroup.querySelectorAll('input').forEach(element => setDisabled(element, rampDisabled));

    const colorBackground = P.bgMode === 'color';
    const backgroundColor = document.getElementById('bgColor');
    backgroundColor.disabled = !colorBackground;
    backgroundColor.closest('.row').style.opacity = colorBackground ? 1 : 0.4;
    document.getElementById('membraneDepth').disabled = true;
    document.getElementById('membraneDepthRow').style.display = 'none';
    for (const key of [
      'membraneBaseColor', 'membraneVeilColor', 'membraneReflectionColor',
      'membraneCardColor', 'membraneShadeColor',
    ]) {
      document.getElementById(key).disabled = true;
      document.getElementById(key + 'Row').style.display = 'none';
    }
    for (const prefix of EDGE_TINT_TARGETS) {
      const multi = P[`${prefix}MultiTint`];
      for (const suffix of ['Tint', 'TintEdge', 'TintColor']) {
        setDisabled(document.getElementById(`${prefix}${suffix}`), false);
      }
      for (const param of edgeTintParams(prefix)) {
        setDisabled(document.getElementById(param.key), param.key !== `${prefix}MultiTint` && !multi);
      }
      document.getElementById(`${prefix}TintPalette`)?.classList.toggle('is-disabled', !multi);
    }

    document.getElementById('lightShowRow').style.display = 'none';
    document.getElementById('lightLookDetails').style.display = 'none';
    document.getElementById('lightIconDetails').style.display = 'none';
    const shellKeys = ['lightShow', 'lightClarity', 'lightDepth', 'lightCardStrength', 'lightChroma'];
    for (const key of [
      ...shellKeys, 'lightIconClarity', 'lightIconColor', 'lightIconTint',
      'lightIconEdge', 'lightIconRimColor', 'lightIconRimStrength',
    ]) {
      setDisabled(document.getElementById(key), true);
    }
    document.body.style.background = colorBackground ? pageBackgroundCss(P.bgColor) : '#000';

    const edgeDropGroup = document.getElementById('edgeDropGroup');
    edgeDropGroup.classList.add('featureGroup');
    edgeDropGroup.classList.toggle(
      'is-disabled', !edgeDropGroup.classList.contains('gated-off') && !P.edgeDropsEnabled,
    );
    edgeDropGroup.querySelectorAll('input').forEach(element => {
      const row = element.closest('.row');
      const survives = !!row && (row.classList.contains('keepEnabled')
        || row.classList.contains('toggleRow'));
      setDisabled(element, !P.edgeDropsEnabled && !survives);
    });

    const isSvg = P.shapeSource === 'svg';
    const shapeButton = document.getElementById('shapeBtn');
    const shapeInput = document.getElementById('shapeInput');
    const accept = isSvg ? '.svg,image/svg+xml'
      : '.glb,.gltf,model/gltf-binary,model/gltf+json';
    shapeButton.textContent = isSvg ? '選擇 SVG…' : '選擇 GLB / GLTF…';
    shapeInput.accept = accept;
    const morphButton = document.getElementById('morphTargetBtn');
    if (morphButton) {
      morphButton.textContent = isSvg ? '選擇變形目標 SVG…' : '選擇變形目標 GLB / GLTF…';
      document.getElementById('morphTargetInput').accept = accept;
    }
    refreshInspector();
  }

  return { applyGates, updateUIState };
}
