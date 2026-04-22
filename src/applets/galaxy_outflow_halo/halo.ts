import { G_KPC_MSUN } from "./units";

/**
 * NFW halo: fix ρ₀ so M(<r_vir) = M_DM,vir for concentration c = r_vir/r_s.
 */
export function nfwScaleRadius(rVirKpc: number, concentration: number): number {
  return rVirKpc / Math.max(concentration, 1e-6);
}

/** M(<r) = 4π ρ₀ r_s³ [ln(1+x) − x/(1+x)], x = r/r_s */
export function nfwMassEnclosed(rKpc: number, rho0: number, rsKpc: number): number {
  const x = rKpc / Math.max(rsKpc, 1e-12);
  const lx = Math.log(1 + x);
  return 4 * Math.PI * rho0 * rsKpc ** 3 * (lx - x / (1 + x));
}

/** f(c) = ln(1+c) − c/(1+c) */
export function nfwFc(concentration: number): number {
  const c = concentration;
  return Math.log(1 + c) - c / (1 + c);
}

/** ρ₀ from total DM mass inside r_vir (M_DM,vir = M(<r_vir)) */
export function nfwRho0FromMVir(mVirMsun: number, rVirKpc: number, concentration: number): number {
  const rs = nfwScaleRadius(rVirKpc, concentration);
  const fc = nfwFc(concentration);
  const denom = 4 * Math.PI * rs ** 3 * fc;
  return mVirMsun / Math.max(denom, 1e-30);
}

/** Gravitational potential Φ(r) [(km/s)²] for NFW, with Φ(∞)=0. */
export function nfwPotentialPhiKms2(rKpc: number, rho0: number, rsKpc: number): number {
  const rs = Math.max(rsKpc, 1e-12);
  const r = Math.max(rKpc, 1e-12);
  const x = r / rs;
  return -(4 * Math.PI * G_KPC_MSUN * rho0 * rs ** 3 / r) * Math.log(1 + x);
}

/**
 * Miyamoto–Nagai disk: Φ(R,z) = −GM / √(R² + (a + √(z²+b²))²).
 * Edge-on 2D view: x = in-plane offset from center (cylindrical R, signed), y = height above disk (maps to z).
 */
export const MIYAMOTO_NAGAI_A_KPC = 15;
export const MIYAMOTO_NAGAI_B_KPC = 0.5;

export function miyamotoNagaiPotentialPhiKms2(
  xKpc: number,
  yKpc: number,
  mDiskMsun: number,
  aKpc: number,
  bKpc: number
): number {
  const a = Math.max(aKpc, 1e-12);
  const b = Math.max(bKpc, 1e-12);
  const R2 = xKpc * xKpc;
  const s = Math.sqrt(yKpc * yKpc + b * b);
  const t = a + s;
  const d = Math.sqrt(R2 + t * t);
  return -(G_KPC_MSUN * mDiskMsun) / Math.max(d, 1e-18);
}

/** Acceleration [(km/s)²/kpc] from MN disk (same unit convention as NFW term in sim). */
export function accelerationMiyamotoNagaiKms2PerKpc(
  xKpc: number,
  yKpc: number,
  mDiskMsun: number,
  aKpc: number,
  bKpc: number
): { x: number; y: number } {
  const a = Math.max(aKpc, 1e-12);
  const b = Math.max(bKpc, 1e-12);
  const R2 = xKpc * xKpc;
  const s = Math.sqrt(yKpc * yKpc + b * b);
  const sSafe = Math.max(s, 1e-15);
  const t = a + s;
  const d2sum = R2 + t * t;
  const denom = d2sum * Math.sqrt(d2sum);
  const gm = G_KPC_MSUN * mDiskMsun;
  return {
    x: (-gm * xKpc) / denom,
    y: (-gm * t * (yKpc / sSafe)) / denom
  };
}

/**
 * Escape speed at (x,y) in the combined NFW + Miyamoto–Nagai disk potential (Φ(∞)=0).
 */
export function escapeSpeedKmsHaloPlusMiyamotoNagai(
  xEvalKpc: number,
  yEvalKpc: number,
  rho0: number,
  rsKpc: number,
  mDiskMsun: number,
  aKpc: number,
  bKpc: number
): number {
  const rSph = Math.hypot(xEvalKpc, yEvalKpc);
  const phi =
    nfwPotentialPhiKms2(rSph, rho0, rsKpc) +
    miyamotoNagaiPotentialPhiKms2(xEvalKpc, yEvalKpc, mDiskMsun, aKpc, bKpc);
  const v2 = -2 * phi;
  return Math.sqrt(Math.max(v2, 0));
}
