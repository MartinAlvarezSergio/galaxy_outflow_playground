export type TurnaroundPdfData = {
  binCounts: number[];
  logRMin: number;
  logRMax: number;
  escapeCount: number;
  nBins: number;
};

export type TurnaroundPdfPlotOptions = {
  /** Shown on the plot (e.g. for exported PNGs: mode, drag, timestamp). */
  caption?: string;
};

const PAD_L = 48;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 32;
const ESCAPE_STRIP_FRAC = 0.22;

export function renderTurnaroundPdfPlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: TurnaroundPdfData,
  options?: TurnaroundPdfPlotOptions
): void {
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#070812");
  bg.addColorStop(1, "#0c101c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (options?.caption) {
    ctx.save();
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(200, 205, 225, 0.95)";
    ctx.textAlign = "right";
    ctx.fillText(options.caption, width - PAD_R, PAD_T + 11);
    ctx.restore();
  }

  const total =
    data.binCounts.reduce((a, b) => a + b, 0) + data.escapeCount;

  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;
  const escapeH = plotH * ESCAPE_STRIP_FRAC;
  const histH = plotH - escapeH - 6;
  const histTop = PAD_T + escapeH + 6;

  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(195, 200, 220, 0.85)";

  if (total === 0) {
    ctx.fillText("No completed tracers yet (turnaround or escape at r_max).", PAD_L, height / 2);
    ctx.fillStyle = "rgba(160, 165, 180, 0.65)";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.fillText("Run until particles apocenter or leave the domain.", PAD_L, height / 2 + 18);
    return;
  }

  const pdfEsc = data.escapeCount / total;

  ctx.fillStyle = "rgba(230, 210, 160, 0.95)";
  ctx.fillText("Escaped (no turnaround)", PAD_L, PAD_T + 12);
  const barMaxW = plotW * 0.92;
  const escBarW = barMaxW * pdfEsc;
  ctx.fillStyle = "rgba(255, 200, 120, 0.45)";
  ctx.fillRect(PAD_L, PAD_T + 18, barMaxW, Math.max(6, escapeH - 22));
  ctx.fillStyle = "rgba(255, 210, 140, 0.88)";
  ctx.fillRect(PAD_L, PAD_T + 18, escBarW, Math.max(6, escapeH - 22));
  ctx.fillStyle = "rgba(220, 215, 235, 0.9)";
  ctx.fillText(`${(pdfEsc * 100).toFixed(1)}%  (${data.escapeCount}/${total})`, PAD_L + barMaxW + 8, PAD_T + 28);

  const n = data.nBins;
  const span = data.logRMax - data.logRMin;
  let maxPdf = 0;
  for (let i = 0; i < n; i += 1) {
    const p = data.binCounts[i] / total;
    if (p > maxPdf) {
      maxPdf = p;
    }
  }
  if (maxPdf < 1e-12) {
    maxPdf = 1;
  }

  ctx.strokeStyle = "rgba(100, 130, 180, 0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const ly = histTop + (i / 4) * histH;
    ctx.beginPath();
    ctx.moveTo(PAD_L, ly);
    ctx.lineTo(PAD_L + plotW, ly);
    ctx.stroke();
  }

  const gap = 1;
  const bw = (plotW - gap * (n - 1)) / n;

  for (let i = 0; i < n; i += 1) {
    const pdf = data.binCounts[i] / total;
    const bh = (pdf / maxPdf) * histH * 0.92;
    const x = PAD_L + i * (bw + gap);
    const y = histTop + histH - bh;
    ctx.fillStyle = "rgba(130, 190, 255, 0.75)";
    ctx.fillRect(x, y, bw, bh);
  }

  ctx.fillStyle = "rgba(210, 215, 230, 0.9)";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText("PDF of r at first apocenter (log10 r / kpc)", PAD_L, height - 6);

  const ticks = [-1, 0, 1, 2];
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(170, 175, 195, 0.8)";
  for (const tv of ticks) {
    if (tv < data.logRMin || tv > data.logRMax) {
      continue;
    }
    const u = (tv - data.logRMin) / span;
    const x = PAD_L + u * plotW;
    ctx.fillText(`10^${tv}`, x - 10, histTop + histH + 14);
  }
}
