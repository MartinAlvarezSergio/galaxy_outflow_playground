import { gasDensity } from "./gasProfile";
import type { GasProfile } from "./types";
import { MSUN_PER_KPC3_TO_G_PER_CM3 } from "./units";

export type GasDensityPlotInputs = {
  profile: GasProfile;
  rho0MsunPerKpc3: number;
  singleExponent: number;
  gasSofteningKpc: number;
  rKneeKpc: number;
  gamma1: number;
  gamma2: number;
  /** Plot log10(r) from rMinKpc to rMaxKpc */
  rMinKpc: number;
  rMaxKpc: number;
};

export type GasDensityPlotParticle = {
  rKpc: number;
  upward: boolean;
};

/**
 * Laid out for a compact inset (~300 × 160 logical px). `width` and `height` are logical
 * units; the caller sets the context transform to the backing-store scale.
 */
const PAD_L = 42;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 30;
const DOT_R = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function log10RhoGcc(rhoMsunPerKpc3: number): number {
  return Math.log10(Math.max(rhoMsunPerKpc3 * MSUN_PER_KPC3_TO_G_PER_CM3, 1e-45));
}

export function renderGasDensityPlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gas: GasDensityPlotInputs,
  particles: GasDensityPlotParticle[]
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#060910");
  bg.addColorStop(1, "#0a1018");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const logRMin = Math.log10(Math.max(gas.rMinKpc, 1e-4));
  const logRMax = Math.log10(Math.max(gas.rMaxKpc, gas.rMinKpc * 1.01));

  const nSample = 180;
  let logRhoMin = 99;
  let logRhoMax = -99;
  const curveLogR: number[] = [];
  const curveLogRho: number[] = [];

  for (let i = 0; i <= nSample; i += 1) {
    const u = i / nSample;
    const logR = logRMin + u * (logRMax - logRMin);
    const r = 10 ** logR;
    const rho = gasDensity(
      r,
      gas.profile,
      gas.rho0MsunPerKpc3,
      gas.singleExponent,
      gas.gasSofteningKpc,
      gas.rKneeKpc,
      gas.gamma1,
      gas.gamma2
    );
    const lr = log10RhoGcc(rho);
    curveLogR.push(logR);
    curveLogRho.push(lr);
    logRhoMin = Math.min(logRhoMin, lr);
    logRhoMax = Math.max(logRhoMax, lr);
  }

  for (const p of particles) {
    const rk = clamp(p.rKpc, gas.rMinKpc, gas.rMaxKpc);
    const rho = gasDensity(
      rk,
      gas.profile,
      gas.rho0MsunPerKpc3,
      gas.singleExponent,
      gas.gasSofteningKpc,
      gas.rKneeKpc,
      gas.gamma1,
      gas.gamma2
    );
    const lr = log10RhoGcc(rho);
    logRhoMin = Math.min(logRhoMin, lr);
    logRhoMax = Math.max(logRhoMax, lr);
  }

  const pad = 0.12;
  const lrSpan = logRMax - logRMin || 1;
  const lrhoSpan = logRhoMax - logRhoMin || 1;
  const logR0 = logRMin - pad * lrSpan;
  const logR1 = logRMax + pad * lrSpan;
  const lrho0 = logRhoMin - pad * lrhoSpan;
  const lrho1 = logRhoMax + pad * lrhoSpan;

  function xData(logR: number): number {
    return PAD_L + ((logR - logR0) / (logR1 - logR0)) * plotW;
  }

  function yData(logRhoVal: number): number {
    return PAD_T + (1 - (logRhoVal - lrho0) / (lrho1 - lrho0)) * plotH;
  }

  ctx.strokeStyle = "rgba(100, 130, 180, 0.35)";
  ctx.lineWidth = 1;
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(200, 205, 220, 0.75)";

  ctx.textAlign = "center";
  const r0 = Math.ceil(logR0);
  const r1 = Math.floor(logR1);
  for (let tr = r0; tr <= r1; tr += 1) {
    const x = xData(tr);
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, PAD_T + plotH);
    ctx.stroke();
    const label = tr === 0 ? "1" : `10^${tr}`;
    ctx.fillText(label, clamp(x, PAD_L + 12, width - PAD_R - 14), PAD_T + plotH + 12);
  }

  ctx.textAlign = "right";
  const g0 = Math.ceil(lrho0);
  const g1 = Math.floor(lrho1);
  for (let tg = g0; tg <= g1; tg += 1) {
    const y = yData(tg);
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(PAD_L + plotW, y);
    ctx.stroke();
    ctx.fillText(`${tg}`, PAD_L - 5, y + 3.5);
  }
  ctx.textAlign = "left";

  ctx.strokeStyle = "rgba(160, 200, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < curveLogR.length; i += 1) {
    const x = xData(curveLogR[i]);
    const y = yData(curveLogRho[i]);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  for (const p of particles) {
    const rk = Math.max(p.rKpc, 1e-4);
    const rho = gasDensity(
      rk,
      gas.profile,
      gas.rho0MsunPerKpc3,
      gas.singleExponent,
      gas.gasSofteningKpc,
      gas.rKneeKpc,
      gas.gamma1,
      gas.gamma2
    );
    const lx = Math.log10(rk);
    const ly = log10RhoGcc(rho);
    const px = xData(lx);
    const py = yData(ly);
    ctx.beginPath();
    ctx.fillStyle = p.upward ? "rgba(120, 220, 255, 0.95)" : "rgba(255, 190, 140, 0.95)";
    ctx.arc(px, py, DOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.arc(px, py, DOT_R, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(210, 215, 230, 0.9)";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("log10(r / kpc)", PAD_L + plotW / 2, height - 5);
  ctx.save();
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.translate(11, PAD_T + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("log10(rho / [g cm^-3])", 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
}
