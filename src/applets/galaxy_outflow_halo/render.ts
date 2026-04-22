import { INNER_SINK_R_FRAC_RVIR } from "./sim";
import { GalaxyOutflowSnapshot } from "./types";

type RenderOptions = {
  showTrails: boolean;
  showVectors: boolean;
};

function particleRadius(massMsun: number): number {
  const logM = Math.log10(Math.max(massMsun, 1e3));
  return 2 + Math.max(0, logM - 4) * 0.9;
}

function toPixel(
  centerPx: { x: number; y: number },
  posKpc: { x: number; y: number },
  kpcPerPixel: number
): { x: number; y: number } {
  return {
    x: centerPx.x + posKpc.x / kpcPerPixel,
    y: centerPx.y - posKpc.y / kpcPerPixel
  };
}

function formatKpcLabel(kpc: number): string {
  if (kpc >= 100) {
    return kpc.toFixed(0);
  }
  if (kpc >= 10) {
    return kpc.toFixed(1);
  }
  return kpc.toFixed(2);
}

export function renderGalaxyOutflow(
  ctx: CanvasRenderingContext2D,
  snapshot: GalaxyOutflowSnapshot,
  options: RenderOptions
): void {
  const { width, height, centerPx, nfwRsKpc, kpcPerPixel, particles, derived } = snapshot;
  const rVirKpc = Math.max(derived.rVirKpc, 1e-6);
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#050810");
  bg.addColorStop(0.45, "#0a1020");
  bg.addColorStop(1, "#060812");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(120, 160, 220, 0.1)";
  ctx.lineWidth = 1;
  const rings = 6;
  for (let k = 1; k <= rings; k += 1) {
    const radKpc = (nfwRsKpc * k) / 2;
    const radPx = radKpc / kpcPerPixel;
    ctx.beginPath();
    ctx.arc(centerPx.x, centerPx.y, radPx, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Virial-radius reference (NFW virial radius from controls) */
  const virialFracs: { f: number; stroke: string }[] = [
    { f: 0.2, stroke: "rgba(255, 210, 140, 0.42)" },
    { f: 0.5, stroke: "rgba(255, 185, 100, 0.5)" },
    { f: 1, stroke: "rgba(255, 165, 70, 0.58)" }
  ];
  const labelAnglesRad = [2.5, 2.15, 1.75];
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < virialFracs.length; i += 1) {
    const { f, stroke } = virialFracs[i];
    const radKpc = f * rVirKpc;
    const radPx = radKpc / kpcPerPixel;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.arc(centerPx.x, centerPx.y, radPx, 0, Math.PI * 2);
    ctx.stroke();
    const ang = labelAnglesRad[i] ?? 2.2;
    const lx = centerPx.x + (radPx + 18) * Math.cos(ang);
    const ly = centerPx.y - (radPx + 18) * Math.sin(ang);
    const label = `${f} r_vir (${formatKpcLabel(radKpc)} kpc)`;
    ctx.fillStyle = "rgba(255, 230, 200, 0.88)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = 3;
    ctx.strokeText(label, lx, ly);
    ctx.lineWidth = 1.5;
    ctx.fillText(label, lx, ly);
  }
  ctx.setLineDash([]);

  /** Inner sink radius (matches sim: inward tracers removed inside this sphere) */
  const sinkRadKpc = INNER_SINK_R_FRAC_RVIR * rVirKpc;
  const sinkRadPx = sinkRadKpc / kpcPerPixel;
  ctx.strokeStyle = "rgba(220, 60, 60, 0.85)";
  ctx.lineWidth = 1.25;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(centerPx.x, centerPx.y, sinkRadPx, 0, Math.PI * 2);
  ctx.stroke();
  const sinkAng = 0.85;
  const slx = centerPx.x + (sinkRadPx + 14) * Math.cos(sinkAng);
  const sly = centerPx.y - (sinkRadPx + 14) * Math.sin(sinkAng);
  const sinkLabel = `0.02 r_vir (${formatKpcLabel(sinkRadKpc)} kpc)`;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = "rgba(255, 180, 175, 0.92)";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
  ctx.lineWidth = 2.5;
  ctx.strokeText(sinkLabel, slx, sly);
  ctx.lineWidth = 1.25;
  ctx.fillText(sinkLabel, slx, sly);

  ctx.strokeStyle = "rgba(180, 200, 255, 0.08)";
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(centerPx.x, 0);
  ctx.lineTo(centerPx.x, height);
  ctx.stroke();
  ctx.setLineDash([]);

  const galR = 14;
  const g = ctx.createRadialGradient(centerPx.x, centerPx.y, 2, centerPx.x, centerPx.y, galR * 2.2);
  g.addColorStop(0, "rgba(255, 248, 230, 0.95)");
  g.addColorStop(0.35, "rgba(200, 210, 255, 0.5)");
  g.addColorStop(1, "rgba(80, 100, 160, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(centerPx.x, centerPx.y, galR * 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 252, 245, 0.98)";
  ctx.beginPath();
  ctx.arc(centerPx.x, centerPx.y, galR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(centerPx.x, centerPx.y, galR * 3.2, galR * 0.35, 0, 0, Math.PI * 2);
  ctx.stroke();

  /* Trails after galaxy art so they are not painted over by the bulge/disk fills. */
  if (options.showTrails) {
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const p of particles) {
      if (p.trailPx.length < 2) {
        continue;
      }
      ctx.strokeStyle = p.upward ? "rgba(130, 220, 255, 0.42)" : "rgba(255, 200, 150, 0.42)";
      ctx.beginPath();
      ctx.moveTo(p.trailPx[0].x, p.trailPx[0].y);
      for (let i = 1; i < p.trailPx.length; i += 1) {
        ctx.lineTo(p.trailPx[i].x, p.trailPx[i].y);
      }
      ctx.stroke();
    }
  }

  for (const p of particles) {
    const pos = toPixel(centerPx, p.positionKpc, kpcPerPixel);
    ctx.beginPath();
    ctx.fillStyle = p.upward ? "rgba(150, 230, 255, 0.95)" : "rgba(255, 200, 150, 0.95)";
    ctx.arc(pos.x, pos.y, particleRadius(p.massMsun), 0, Math.PI * 2);
    ctx.fill();

    if (options.showVectors) {
      const scale = 0.12;
      const vx = p.velocityKms.x * scale;
      const vy = -p.velocityKms.y * scale;
      ctx.strokeStyle = "rgba(100, 255, 180, 0.75)";
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x + vx, pos.y + vy);
      ctx.stroke();
    }
  }
}
