import { Vec2 } from "../../core/vector";

export type OutflowMode = "ballistic" | "drag";

export type GasProfile = "single_power" | "double_power";

export type OutflowParticle = {
  /** Position relative to galaxy center, kpc */
  positionKpc: Vec2;
  /** km/s */
  velocityKms: Vec2;
  /** Effective mass for drag (M☉), e.g. cloud / shell */
  massMsun: number;
  /** Screen-space trail samples for drawing */
  trailPx: Vec2[];
  upward: boolean;
};

export type GalaxyOutflowSnapshot = {
  width: number;
  height: number;
  /** Pixel center of galaxy */
  centerPx: Vec2;
  /** kpc per canvas pixel (same x and y) */
  kpcPerPixel: number;
  /** NFW scale radius rₛ (kpc) for guide rings */
  nfwRsKpc: number;
  particles: OutflowParticle[];
  /** km/s */
  maxSpeedKms: number;
  activeCount: number;
  /** Derived readouts */
  derived: {
    nfwRho0MsunPerKpc3: number;
    rsKpc: number;
    rVirKpc: number;
    mDmVirMsun: number;
  };
  /** Continuous stream: particles ejected this run, cap, and whether emitting */
  streamEjected: number;
  streamMax: number;
  streamActive: boolean;
  /** Histogram of radius (kpc) at first radial turnaround + escape count */
  turnaroundPdf: {
    binCounts: number[];
    logRMin: number;
    logRMax: number;
    escapeCount: number;
    nBins: number;
  };
};

export type GalaxyOutflowSettings = {
  mDmVirMsun: number;
  rVirKpc: number;
  concentration: number;
  mGalaxyMsun: number;
  /** Half-width of field in kpc (maps view to canvas) */
  fieldHalfWidthKpc: number;
  /** Simulation time: Myr of evolution per second of wall clock */
  timeRateMyrPerSec: number;
  outflowSpeedKms: number;
  particleMassMsun: number;
  burstPairs: number;
  /** Half-width along disk in kpc */
  launchSpreadKpc: number;
  /** Full angle (deg) of in-plane cone around +/-y; 0 = strictly perpendicular */
  openingAngleDeg: number;
  mode: OutflowMode;
  dragStrength: number;
  gasProfile: GasProfile;
  /** Reference gas density scale M☉/kpc³ */
  gasDensityScaleMsunPerKpc3: number;
  singleExponent: number;
  gasSofteningKpc: number;
  doubleRkneeKpc: number;
  doubleGamma1: number;
  doubleGamma2: number;
};
