// The ±10 semitone scale, drawn two ways: as the arc around the circle on
// Measure, and as a straight line on results. Target in the middle.
import { SPAN, shapeColour } from './zone.js';

const STEPS = SPAN * 2 + 1;
const CX = 150;
const CY = 150;
const R = 132;
const START = 135;
const SEG = 270 / STEPS;

const clamp = (off) => Math.max(-SPAN, Math.min(SPAN, off));
const point = (deg) => {
  const a = (deg * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
};
const attr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function arcSvg() {
  const paths = [];
  for (let k = 0; k < STEPS; k += 1) {
    const [x0, y0] = point(START + k * SEG + 0.9);
    const [x1, y1] = point(START + (k + 1) * SEG - 0.9);
    paths.push(
      `<path data-step="${k}" d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${shapeColour(k - SPAN)}" opacity="0.8"/>`
    );
  }
  return `<svg class="arc" viewBox="0 0 300 300" aria-hidden="true">
    <g fill="none" stroke-width="4.5" stroke-linecap="round">${paths.join('')}</g>
    <circle class="arc-tick" cx="150" cy="6" r="2.5"/>
    <circle class="arc-dot" data-el="arc-dot" cx="150" cy="18" r="6.5" stroke-width="2.5" opacity="0"/>
  </svg>`;
}

// Ready: the dot shows where the voice is, in cream, without judging it.
// Recording: the step under the voice lights up and the dot takes its colour.
// `exact` (fractional semitones) places the dot precisely between steps;
// without it the dot sits in the middle of the step.
export function paintArc(svg, { off, exact = null, recording, hearing }) {
  const active = recording && off !== null ? clamp(off) : null;
  svg.querySelectorAll('[data-step]').forEach((path) => {
    path.setAttribute('opacity', Number(path.dataset.step) - SPAN === active ? '1' : '0.8');
  });
  const dot = svg.querySelector('[data-el="arc-dot"]');
  const show = off !== null && (recording || hearing);
  dot.setAttribute('opacity', show ? '1' : '0');
  if (!show) return;
  const at = exact === null ? off : Math.max(-SPAN - 0.5, Math.min(SPAN + 0.5, exact));
  const [x, y] = point(START + (at + SPAN) * SEG + SEG / 2);
  dot.setAttribute('cx', x.toFixed(1));
  dot.setAttribute('cy', y.toFixed(1));
  dot.style.stroke = recording ? shapeColour(off) : '';
}

export function lineScaleSvg(off, { width = 320, label = '' } = {}) {
  const step = width / STEPS;
  const at = off === null ? null : clamp(off);
  let lines = '';
  for (let k = 0; k < STEPS; k += 1) {
    lines += `<line x1="${(k * step + 2.5).toFixed(1)}" y1="17" x2="${((k + 1) * step - 2.5).toFixed(1)}" y2="17" stroke="${shapeColour(k - SPAN)}" opacity="${k - SPAN === at ? 1 : 0.8}"/>`;
  }
  const dot =
    at === null
      ? ''
      : `<circle class="scale-dot" cx="${((at + SPAN + 0.5) * step).toFixed(1)}" cy="17" r="6.5" stroke="${shapeColour(off)}" stroke-width="3"/>`;
  return `<svg class="scale" viewBox="0 0 ${width} 34" style="max-width:${width}px" role="img" aria-label="${attr(label)}">
    <g stroke-width="5" stroke-linecap="round">${lines}</g>
    <line class="scale-tick" x1="${width / 2}" y1="5" x2="${width / 2}" y2="29" stroke-width="1.5"/>${dot}
  </svg>`;
}
