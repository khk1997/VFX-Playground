'use strict';

import { MOTION_PARAMS } from './motions/registry.js?v=type-center-1';

function buildMotionSubgroup(param, block) {
  const details = document.createElement('details');
  details.className = 'subgroup';
  details.open = param.open !== false;
  if (param.gate) details.dataset.gate = param.gate;
  const summary = document.createElement('summary');
  const heading = document.createElement('h4');
  heading.textContent = param.label;
  summary.append(heading);
  if (param.key) {
    const holder = document.createElement('span');
    holder.className = 'summaryToggle';
    holder.addEventListener('click', event => event.stopPropagation());
    const control = document.createElement('input');
    control.type = 'checkbox';
    control.id = param.key;
    control.checked = Boolean(param.value);
    const track = document.createElement('span');
    track.className = 'switchTrack';
    track.setAttribute('aria-hidden', 'true');
    holder.append(control, track);
    summary.append(holder);
  }
  details.append(summary);
  block.append(details);
  return details;
}

export function buildExtendedMotionControls() {
  const host = document.getElementById('extendedMotionControls');
  if (!host || host.childElementCount) return;
  for (const [motion, params] of Object.entries(MOTION_PARAMS)) {
    if (!params.length) continue;
    const block = document.createElement('div');
    block.className = 'modeBlock';
    block.dataset.gate = motion === 'capillary' ? 'capillaryTextureUI' : motion;
    let container = block;
    for (const param of params) {
      if (param.type === 'subgroup') {
        container = buildMotionSubgroup(param, block);
        continue;
      }
      if (param.type === 'borrow') {
        const anchor = document.createElement('div');
        anchor.className = 'borrowAnchor';
        anchor.dataset.borrow = param.key;
        if (param.label) anchor.dataset.borrowLabel = param.label;
        anchor.style.display = 'none';
        container.append(anchor);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'row';
      row.id = `${param.key}Row`;
      const label = document.createElement('label');
      label.htmlFor = param.key;
      label.textContent = param.label;
      if (param.gate) row.dataset.gate = param.gate;
      const tag = param.type === 'select' ? 'select'
        : param.type === 'text' ? 'textarea'
        : 'input';
      const control = document.createElement(tag);
      control.id = param.key;
      let track = null;
      if (param.type === 'toggle') {
        row.classList.add('toggleRow');
        control.type = 'checkbox';
        control.checked = Boolean(param.value);
        track = document.createElement('span');
        track.className = 'switchTrack';
        track.setAttribute('aria-hidden', 'true');
      } else if (param.type === 'text') {
        control.rows = 3;
        control.spellcheck = false;
        control.placeholder = '一行一句';
        row.classList.add('textRow');
      } else if (param.type === 'select') {
        for (const optionSpec of param.options) {
          const option = document.createElement('option');
          option.value = String(optionSpec.value);
          option.textContent = optionSpec.label;
          if (optionSpec.hidden) option.hidden = true;
          control.append(option);
        }
      } else if (param.type === 'color') {
        control.type = 'color';
      } else {
        control.type = 'range';
        control.min = String(param.min);
        control.max = String(param.max);
        control.step = String(param.step);
      }
      if (param.type !== 'toggle') control.value = String(param.value);
      const value = document.createElement('span');
      value.className = 'val';
      if (param.type !== 'select') value.id = `${param.key}_v`;
      if (track) row.append(label, control, track, value);
      else row.append(label, control, value);
      if (param.tintPalette) {
        const prefix = param.tintPalette;
        let palette = container.querySelector(`#${prefix}TintPalette`);
        if (!palette) {
          palette = document.createElement('details');
          palette.id = `${prefix}TintPalette`;
          palette.className = 'tintPalette';
          const summary = document.createElement('summary');
          summary.textContent = '邊界色盤 · 6 色';
          const preview = document.createElement('span');
          preview.id = `${prefix}TintPreview`;
          preview.className = 'tintPalettePreview';
          summary.append(preview);
          const note = document.createElement('p');
          note.className = 'tintPaletteNote';
          note.textContent = '位置沿輪廓繞一圈；拉開色標可拓寬色帶。首尾自動接色。';
          palette.append(summary, note);
          container.append(palette);
        }
        palette.append(row);
      } else {
        container.append(row);
      }
      if (param.type === 'text') {
        const note = document.createElement('div');
        note.className = 'row noteRow';
        note.id = `${param.key}Info`;
        container.append(note);
      }
    }
    host.append(block);
  }
}
