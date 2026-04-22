/**
 * Astrophysical units for disk/halo toy model (kpc, M☉, km/s, Myr).
 * G in (km/s)² kpc / M☉ — gives v² = GM/r with r in kpc, M in M☉, v in km/s.
 */
export const G_KPC_MSUN = 4.302e-6;

/** km per kpc — convert acceleration (km/s)²/kpc to km/s² */
export const KM_PER_KPC = 3.085677581e16;

export const SEC_PER_MYR = 3.15576e13;

/** 1 kpc in cm (exact SI path: kpc defined via AU) */
export const CM_PER_KPC = 3.085677581e21;
/** Nominal solar mass in grams */
export const GRAMS_PER_MSUN = 1.98847e33;
/**
 * ρ [g/cm³] = ρ [M☉/kpc³] × M☉[g] / (kpc[cm])³
 * Check: 1 M☉/kpc³ ≈ 6.77×10⁻³⁴ g/cm³
 */
export const MSUN_PER_KPC3_TO_G_PER_CM3 = GRAMS_PER_MSUN / CM_PER_KPC ** 3;
/** Convert ρ [g/cm³] → [M☉/kpc³] for the gas model (inverse of the above). */
export const G_PER_CM3_TO_MSUN_PER_KPC3 = 1 / MSUN_PER_KPC3_TO_G_PER_CM3;

/** MW-like defaults (order-of-magnitude literature values) */
export const MW_M_DM_VIR = 1.2e12;
export const MW_R_VIR_KPC = 200;
export const MW_C_NFW = 12;
/** Disk stellar mass scale for Miyamoto–Nagai baryon potential (~6×10¹⁰ M☉) */
export const MW_M_GALAXY_MSUN = 6e10;
export const MW_V_OUT_KMS = 400;
/** Full opening angle (deg) in the plane: cone around +/-y, perpendicular to the disk */
export const MW_OPENING_ANGLE_DEG = 3;
/**
 * Default view half-width (kpc from center to left/right edge). Set to ~0.5 r_vir so the field span is
 * ~r_vir across at the MW default virial radius.
 */
export const MW_FIELD_HALF_KPC = 0.5 * MW_R_VIR_KPC;
