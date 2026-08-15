// The analog dB dial, as an SVG string. Shared by the extension panel and the
// web app so the two can't drift into being subtly different instruments.
//
// Pure: it builds markup and does no DOM work, which is also what makes it
// testable in Node.

export const DB_MIN = 20;
export const DB_MAX = 130;
const DB_MAJOR_STEP = 10;
const DB_MINORS_PER_MAJOR = 5;

// The Current/Average dB numbers are derived from the very same 0..1 level
// that rotates the needle, so the readout can never disagree with the dial.
export function dbFromLevel(level) {
  return DB_MIN + level * (DB_MAX - DB_MIN);
}

// Geometry of the analog VU face. The needle sweeps the top half-circle:
// 180° points at DB_MIN (left), 0° at DB_MAX (right).
const METER = {
  cx: 120,
  cy: 128,
  rArc: 108,
  rMajorInner: 96,
  rMinorInner: 102,
  rLabel: 84,
  rBandArc: 60,
};

function meterAngleRad(db) {
  const fraction = (db - DB_MIN) / (DB_MAX - DB_MIN);
  return ((180 - fraction * 180) * Math.PI) / 180;
}

function meterPoint(db, radius) {
  const angle = meterAngleRad(db);
  return {
    x: METER.cx + radius * Math.cos(angle),
    y: METER.cy - radius * Math.sin(angle),
  };
}

export function buildDbMeterSvg() {
  let ticks = '';
  let labels = '';

  const minorStep = DB_MAJOR_STEP / DB_MINORS_PER_MAJOR;
  for (let db = DB_MIN; db <= DB_MAX + 0.001; db += minorStep) {
    const isMajor = Math.abs(db % DB_MAJOR_STEP) < 0.001;
    const inner = meterPoint(db, isMajor ? METER.rMajorInner : METER.rMinorInner);
    const outer = meterPoint(db, METER.rArc);
    ticks +=
      `<line x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}" ` +
      `x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}" ` +
      `stroke="currentColor" stroke-width="${isMajor ? 1.6 : 0.8}" />`;

    if (isMajor) {
      const at = meterPoint(db, METER.rLabel);
      // Rotate each number so it sits tangent to the arc, as on a real dial.
      const rotation = 90 - (meterAngleRad(db) * 180) / Math.PI;
      labels +=
        `<text x="${at.x.toFixed(1)}" y="${at.y.toFixed(1)}" font-size="11" ` +
        `text-anchor="middle" dominant-baseline="middle" fill="currentColor" ` +
        `transform="rotate(${rotation.toFixed(1)} ${at.x.toFixed(1)} ${at.y.toFixed(1)})">${Math.round(db)}</text>`;
    }
  }

  // The comfortable-speaking band drawn inside the dial: a light arc from
  // MIN to MAX with a peak mark at its centre, mirroring the reference face.
  const bandStart = meterPoint(35, METER.rBandArc);
  const bandEnd = meterPoint(80, METER.rBandArc);
  const bandPeak = meterPoint(57, METER.rBandArc + 12);
  const bandPeakLeft = meterPoint(52, METER.rBandArc);
  const bandPeakRight = meterPoint(62, METER.rBandArc);
  const minLabel = meterPoint(31, METER.rBandArc - 10);
  const maxLabel = meterPoint(86, METER.rBandArc - 4);

  const needleTip = METER.cy - (METER.rArc - 6);

  return `
    <svg viewBox="0 0 240 172" class="db-meter-svg">
      <path d="M ${(METER.cx - METER.rArc).toFixed(1)} ${METER.cy}
               A ${METER.rArc} ${METER.rArc} 0 0 1 ${(METER.cx + METER.rArc).toFixed(1)} ${METER.cy}"
            fill="none" stroke="currentColor" stroke-width="1.6" />
      ${ticks}
      ${labels}

      <path d="M ${bandStart.x.toFixed(1)} ${bandStart.y.toFixed(1)}
               A ${METER.rBandArc} ${METER.rBandArc} 0 0 1 ${bandEnd.x.toFixed(1)} ${bandEnd.y.toFixed(1)}"
            fill="none" class="meter-muted" stroke="currentColor" stroke-width="0.9" />
      <polyline points="${bandPeakLeft.x.toFixed(1)},${bandPeakLeft.y.toFixed(1)}
                        ${bandPeak.x.toFixed(1)},${bandPeak.y.toFixed(1)}
                        ${bandPeakRight.x.toFixed(1)},${bandPeakRight.y.toFixed(1)}"
                fill="none" class="meter-muted" stroke="currentColor" stroke-width="0.9" />
      <text x="${minLabel.x.toFixed(1)}" y="${minLabel.y.toFixed(1)}" font-size="7" class="meter-muted" fill="currentColor"
            text-anchor="middle" transform="rotate(-60 ${minLabel.x.toFixed(1)} ${minLabel.y.toFixed(1)})">MIN</text>
      <text x="${maxLabel.x.toFixed(1)}" y="${maxLabel.y.toFixed(1)}" font-size="7" class="meter-muted" fill="currentColor"
            text-anchor="middle">MAX</text>

      <text x="${METER.cx}" y="${METER.cy + 26}" font-size="17" font-weight="700"
            text-anchor="middle" fill="currentColor">dB</text>

      <line data-el="target-mark" x1="${METER.cx}" y1="${METER.cy - 42}" x2="${METER.cx}" y2="${needleTip}"
            class="meter-target" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
            style="transform-origin: ${METER.cx}px ${METER.cy}px;" />

      <line data-el="needle" x1="${METER.cx}" y1="${METER.cy + 14}" x2="${METER.cx}" y2="${needleTip}"
            class="meter-needle" stroke="currentColor" stroke-width="2" style="transform-origin: ${METER.cx}px ${METER.cy}px;" />
      <circle cx="${METER.cx}" cy="${METER.cy}" r="4.5" class="meter-needle" fill="currentColor" />

      <rect data-el="peak-light" x="196" y="152" width="8" height="8" fill="none" stroke="currentColor" stroke-width="0.9" />
      <rect data-el="peak-light" x="208" y="152" width="8" height="8" fill="none" stroke="currentColor" stroke-width="0.9" />
      <rect data-el="peak-light" x="220" y="152" width="8" height="8" fill="none" stroke="currentColor" stroke-width="0.9" />
    </svg>
  `;
}
