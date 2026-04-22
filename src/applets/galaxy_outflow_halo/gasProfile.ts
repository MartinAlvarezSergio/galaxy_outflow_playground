import type { GasProfile } from "./types";

/**
 * Gas density ρ(r) in M☉ kpc⁻³ (same model as drag in sim).
 * Single power: ρ = ρ₀ (r_soft / max(r,r_soft))ⁿ, so for r ≫ r_soft, ρ ∝ r⁻ⁿ (n > 0 = decreasing outward).
 */
export function gasDensity(
  rKpc: number,
  profile: GasProfile,
  rho0: number,
  singleExponent: number,
  gasSofteningKpc: number,
  rKneeKpc: number,
  g1: number,
  g2: number
): number {
  const rsf = Math.max(rKpc, gasSofteningKpc);
  if (profile === "single_power") {
    return rho0 * (gasSofteningKpc / rsf) ** singleExponent;
  }
  const x = rsf / Math.max(rKneeKpc, 1e-6);
  return rho0 * x ** (-g1) * (1 + x) ** (-(g2 - g1));
}

/** ρ at r=0: uses inner floor r_soft = max(0, r_soft) (same as drag law). */
export function gasDensityAtCenter(
  profile: GasProfile,
  rho0: number,
  singleExponent: number,
  gasSofteningKpc: number,
  rKneeKpc: number,
  g1: number,
  g2: number
): number {
  return gasDensity(0, profile, rho0, singleExponent, gasSofteningKpc, rKneeKpc, g1, g2);
}
