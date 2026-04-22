import { magnitude, Vec2 } from "../../core/vector";
import { gasDensity } from "./gasProfile";
import {
  accelerationMiyamotoNagaiKms2PerKpc,
  MIYAMOTO_NAGAI_A_KPC,
  MIYAMOTO_NAGAI_B_KPC,
  nfwMassEnclosed,
  nfwRho0FromMVir,
  nfwScaleRadius
} from "./halo";
import {
  GasProfile,
  GalaxyOutflowSettings,
  GalaxyOutflowSnapshot,
  OutflowMode,
  OutflowParticle
} from "./types";
import { G_KPC_MSUN, KM_PER_KPC, SEC_PER_MYR } from "./units";

const LOGICAL_WIDTH = 900;
const LOGICAL_HEIGHT = 620;
/**
 * Plummer softening ε (kpc) for the NFW monopole only; baryons use a Miyamoto–Nagai disk (see halo.ts).
 * a = −G M r⃗ / (r² + ε²)^{3/2}, with M_enc evaluated at √(r² + ε²) for NFW.
 * Larger ε smooths the cusp and caps peak |a| (~ GM/ε²) so orbit integration stays stable.
 * Default ~500 pc is conservative for this toy integrator (explicit Euler, fixed sub-steps).
 */
export const GRAV_PLUMMER_EPS_KPC = 0.5;
/** Drop tracers inside this radius (in units of r_vir) when radial velocity is inward — avoids pile-up at the center. */
export const INNER_SINK_R_FRAC_RVIR = 0.02;
/** Screen-space samples per tracer (one per integration sub-step in a frame). */
const TRAIL_LEN = 1200;
const MAX_DT_S = 1 / 20;
const MIN_DT_S = 1 / 400;
const MAX_DTMYR_PER_SUB = 0.04;
/**
 * Ram-pressure drag: a_drag = λ · Cd · ρ_gas · v² · (A/m), with constant-density spherical clouds
 * (A ∝ m^(2/3) → A/m ∝ m^(-1/3)). Reference cloud = 10⁵ M☉, effective radius 100 pc.
 * Units cancel cleanly: [M☉/kpc³] · [(km/s)²] · [kpc²/M☉] = [(km/s)²/kpc], matching gravity in sim.
 */
const DRAG_CD = 0.5;
const DRAG_CLOUD_R_KPC = 0.1;
const DRAG_CLOUD_M_REF_MSUN = 1e5;
const DRAG_AREA_OVER_MASS_REF_KPC2_PER_MSUN =
  (Math.PI * DRAG_CLOUD_R_KPC * DRAG_CLOUD_R_KPC) / DRAG_CLOUD_M_REF_MSUN;
/** Wall-clock seconds between each ±y pair during continuous stream */
const STREAM_PAIR_INTERVAL_SEC = 0.055;
/** Stop streaming after this many particles have been spawned (pairs count as 2) */
export const STREAM_MAX_PARTICLES = 1000;

const TURNAROUND_NBINS = 44;
const TURNAROUND_LOG_R_MIN = -1.0;
const TURNAROUND_LOG_R_MAX = 2.35;

type TracerParticle = {
  positionKpc: Vec2;
  velocityKms: Vec2;
  massMsun: number;
  trailPx: Vec2[];
  upward: boolean;
  lastVr: number | null;
  turnaroundDone: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function accelerationGravity(
  relKpc: Vec2,
  rho0: number,
  rsKpc: number,
  mGalMsun: number
): Vec2 {
  const eps = GRAV_PLUMMER_EPS_KPC;
  const r2 = relKpc.x * relKpc.x + relKpc.y * relKpc.y;
  const d2 = r2 + eps * eps;
  const rEff = Math.sqrt(d2);
  const mEnc = nfwMassEnclosed(rEff, rho0, rsKpc);
  // (r² + ε²)^{3/2} = d2 * rEff
  const invD3 = 1 / (d2 * rEff);
  const aNfwX = (-G_KPC_MSUN * mEnc * relKpc.x) * invD3;
  const aNfwY = (-G_KPC_MSUN * mEnc * relKpc.y) * invD3;

  const aDisk = accelerationMiyamotoNagaiKms2PerKpc(
    relKpc.x,
    relKpc.y,
    mGalMsun,
    MIYAMOTO_NAGAI_A_KPC,
    MIYAMOTO_NAGAI_B_KPC
  );

  return { x: aNfwX + aDisk.x, y: aNfwY + aDisk.y };
}

function accelFromState(
  relKpc: Vec2,
  velKms: Vec2,
  massMsun: number,
  mode: OutflowMode,
  dragStrength: number,
  gas: {
    profile: GasProfile;
    rho0: number;
    singleExponent: number;
    gasSofteningKpc: number;
    rKneeKpc: number;
    g1: number;
    g2: number;
  },
  halo: { rho0: number; rsKpc: number; mGalMsun: number }
): Vec2 {
  const grav = accelerationGravity(relKpc, halo.rho0, halo.rsKpc, halo.mGalMsun);
  let ax = grav.x;
  let ay = grav.y;
  const r = Math.hypot(relKpc.x, relKpc.y);

  if (mode === "drag") {
    const rho = gasDensity(
      r,
      gas.profile,
      gas.rho0,
      gas.singleExponent,
      gas.gasSofteningKpc,
      gas.rKneeKpc,
      gas.g1,
      gas.g2
    );
    const vmag = magnitude(velKms);
    if (vmag > 1e-6 && rho > 0) {
      const mSafe = Math.max(massMsun, 1e3);
      const aOverM =
        DRAG_AREA_OVER_MASS_REF_KPC2_PER_MSUN *
        Math.cbrt(DRAG_CLOUD_M_REF_MSUN / mSafe);
      const dragMag = dragStrength * DRAG_CD * rho * vmag * vmag * aOverM;
      ax -= (velKms.x / vmag) * dragMag;
      ay -= (velKms.y / vmag) * dragMag;
    }
  }

  return { x: ax, y: ay };
}

function randomSpread(halfWidthKpc: number): number {
  return (Math.random() - 0.5) * 2 * halfWidthKpc;
}

export type GalaxyOutflowSim = {
  step: (dtRealSeconds: number) => void;
  reset: () => void;
  fireBurst: () => void;
  setMDmVirMsun: (v: number) => void;
  setRVirKpc: (v: number) => void;
  setConcentration: (v: number) => void;
  setMGalaxyMsun: (v: number) => void;
  setFieldHalfWidthKpc: (v: number) => void;
  setTimeRateMyrPerSec: (v: number) => void;
  setOutflowSpeedKms: (v: number) => void;
  setParticleMassMsun: (v: number) => void;
  setBurstPairs: (v: number) => void;
  setLaunchSpreadKpc: (v: number) => void;
  setOpeningAngleDeg: (v: number) => void;
  setMode: (v: OutflowMode) => void;
  setDragStrength: (v: number) => void;
  setGasProfile: (v: GasProfile) => void;
  setGasDensityScaleMsunPerKpc3: (v: number) => void;
  setSingleExponent: (v: number) => void;
  setGasSofteningKpc: (v: number) => void;
  setDoubleRkneeKpc: (v: number) => void;
  setDoubleGamma1: (v: number) => void;
  setDoubleGamma2: (v: number) => void;
  setStreamActive: (active: boolean) => void;
  getSnapshot: () => GalaxyOutflowSnapshot;
};

export function createGalaxyOutflowSim(initial: GalaxyOutflowSettings): GalaxyOutflowSim {
  const centerPx: Vec2 = { x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT / 2 };

  let mDmVirMsun = initial.mDmVirMsun;
  let rVirKpc = initial.rVirKpc;
  let concentration = initial.concentration;
  let mGalaxyMsun = initial.mGalaxyMsun;
  let fieldHalfWidthKpc = initial.fieldHalfWidthKpc;
  let timeRateMyrPerSec = initial.timeRateMyrPerSec;
  let outflowSpeedKms = initial.outflowSpeedKms;
  let particleMassMsun = initial.particleMassMsun;
  let burstPairs = initial.burstPairs;
  let launchSpreadKpc = initial.launchSpreadKpc;
  let openingAngleDeg = initial.openingAngleDeg;
  let mode: OutflowMode = initial.mode;
  let dragStrength = initial.dragStrength;
  let gasProfile: GasProfile = initial.gasProfile;
  let gasDensityScaleMsunPerKpc3 = initial.gasDensityScaleMsunPerKpc3;
  let singleExponent = initial.singleExponent;
  let gasSofteningKpc = initial.gasSofteningKpc;
  let doubleRkneeKpc = initial.doubleRkneeKpc;
  let doubleGamma1 = initial.doubleGamma1;
  let doubleGamma2 = initial.doubleGamma2;

  let particles: TracerParticle[] = [];
  const turnaroundHist = new Array<number>(TURNAROUND_NBINS).fill(0);
  let escapeNoTurnaround = 0;

  function addTurnaroundBin(rKpc: number): void {
    const lr = Math.log10(Math.max(rKpc, 1e-4));
    const span = TURNAROUND_LOG_R_MAX - TURNAROUND_LOG_R_MIN;
    let i = Math.floor(((lr - TURNAROUND_LOG_R_MIN) / span) * TURNAROUND_NBINS);
    i = clamp(i, 0, TURNAROUND_NBINS - 1);
    turnaroundHist[i] += 1;
  }

  let streamActive = false;
  let streamEjected = 0;
  let streamTimeBank = 0;

  function haloDerived(): { rho0: number; rsKpc: number } {
    const rsKpc = nfwScaleRadius(rVirKpc, concentration);
    const rho0 = nfwRho0FromMVir(mDmVirMsun, rVirKpc, concentration);
    return { rho0, rsKpc };
  }

  function kpcPerPixel(): number {
    return fieldHalfWidthKpc / (LOGICAL_WIDTH / 2);
  }

  function farLimitKpc(): number {
    return Math.max(fieldHalfWidthKpc * 2.5, 120);
  }

  function toPixel(p: Vec2): Vec2 {
    const kpp = kpcPerPixel();
    return {
      x: centerPx.x + p.x / kpp,
      y: centerPx.y - p.y / kpp
    };
  }

  function spawnParticle(upward: boolean, offsetXKpc: number): void {
    const speed = outflowSpeedKms;
    const sign = upward ? 1 : -1;
    let vx: number;
    let vy: number;
    // 0 deg = strictly along +/-y (disk normal); skip trig so we never get a stale angle from async UI sync
    if (openingAngleDeg <= 1e-9) {
      vx = 0;
      vy = sign * speed;
    } else {
      const fullRad = (openingAngleDeg * Math.PI) / 180;
      const delta = (Math.random() - 0.5) * fullRad;
      vx = speed * Math.sin(delta);
      vy = sign * speed * Math.cos(delta);
    }
    const pos = { x: offsetXKpc, y: 0 };
    const px0 = toPixel(pos);
    particles.push({
      positionKpc: pos,
      velocityKms: { x: vx, y: vy },
      massMsun: particleMassMsun,
      trailPx: [{ x: px0.x, y: px0.y }],
      upward,
      lastVr: null,
      turnaroundDone: false
    });
  }

  function emitSinglePair(): void {
    const ox = randomSpread(launchSpreadKpc);
    spawnParticle(true, ox);
    spawnParticle(false, ox);
  }

  return {
    step(dtRealSeconds: number): void {
      const dtReal = clamp(dtRealSeconds, MIN_DT_S, MAX_DT_S);
      const dtMyr = dtReal * timeRateMyrPerSec;

      if (dtMyr > 0) {
        const { rho0, rsKpc } = haloDerived();
        const halo = { rho0, rsKpc, mGalMsun: mGalaxyMsun };
        const gas = {
          profile: gasProfile,
          rho0: gasDensityScaleMsunPerKpc3,
          singleExponent,
          gasSofteningKpc,
          rKneeKpc: doubleRkneeKpc,
          g1: doubleGamma1,
          g2: doubleGamma2
        };

        let remainingMyr = dtMyr;
        while (remainingMyr > 1e-15) {
          const dMyr = Math.min(remainingMyr, MAX_DTMYR_PER_SUB);
          remainingMyr -= dMyr;
          const dtS = dMyr * SEC_PER_MYR;

          for (let i = particles.length - 1; i >= 0; i -= 1) {
            const p = particles[i];
            const rel = p.positionKpc;
            const aNat = accelFromState(rel, p.velocityKms, p.massMsun, mode, dragStrength, gas, halo);

            const axKms2 = aNat.x / KM_PER_KPC;
            const ayKms2 = aNat.y / KM_PER_KPC;

            p.velocityKms.x += axKms2 * dtS;
            p.velocityKms.y += ayKms2 * dtS;

            p.positionKpc.x += (p.velocityKms.x * dtS) / KM_PER_KPC;
            p.positionKpc.y += (p.velocityKms.y * dtS) / KM_PER_KPC;

            const x = p.positionKpc.x;
            const y = p.positionKpc.y;
            const dist = Math.hypot(x, y);
            const rSafe = Math.max(dist, 1e-9);
            const vx = p.velocityKms.x;
            const vy = p.velocityKms.y;
            const vr = (vx * x + vy * y) / rSafe;

            if (!p.turnaroundDone && p.lastVr !== null && p.lastVr > 0 && vr <= 0) {
              p.turnaroundDone = true;
              addTurnaroundBin(dist);
            }
            p.lastVr = vr;

            const sinkRKpc = INNER_SINK_R_FRAC_RVIR * rVirKpc;
            if (dist < sinkRKpc && vr < 0) {
              particles.splice(i, 1);
              continue;
            }

            const bad =
              dist > farLimitKpc() ||
              dist !== dist ||
              !Number.isFinite(x) ||
              !Number.isFinite(y) ||
              !Number.isFinite(vx) ||
              !Number.isFinite(vy);
            if (bad) {
              if (!p.turnaroundDone) {
                escapeNoTurnaround += 1;
              }
              particles.splice(i, 1);
              continue;
            }

            const px = toPixel(p.positionKpc);
            p.trailPx.push({ x: px.x, y: px.y });
            if (p.trailPx.length > TRAIL_LEN) {
              p.trailPx.shift();
            }
          }
        }
      }

      if (streamActive && streamEjected < STREAM_MAX_PARTICLES) {
        streamTimeBank += dtReal;
        while (
          streamTimeBank >= STREAM_PAIR_INTERVAL_SEC &&
          streamEjected + 2 <= STREAM_MAX_PARTICLES
        ) {
          streamTimeBank -= STREAM_PAIR_INTERVAL_SEC;
          emitSinglePair();
          streamEjected += 2;
        }
        if (streamEjected >= STREAM_MAX_PARTICLES) {
          streamActive = false;
        }
      }
    },

    reset(): void {
      particles = [];
      streamActive = false;
      streamEjected = 0;
      streamTimeBank = 0;
      for (let b = 0; b < TURNAROUND_NBINS; b += 1) {
        turnaroundHist[b] = 0;
      }
      escapeNoTurnaround = 0;
    },

    fireBurst(): void {
      const pairs = Math.max(1, Math.round(burstPairs));
      for (let i = 0; i < pairs; i += 1) {
        emitSinglePair();
      }
    },

    setMDmVirMsun(v: number): void {
      mDmVirMsun = v;
    },
    setRVirKpc(v: number): void {
      rVirKpc = v;
    },
    setConcentration(v: number): void {
      concentration = v;
    },
    setMGalaxyMsun(v: number): void {
      mGalaxyMsun = v;
    },
    setFieldHalfWidthKpc(v: number): void {
      fieldHalfWidthKpc = v;
    },
    setTimeRateMyrPerSec(v: number): void {
      timeRateMyrPerSec = v;
    },
    setOutflowSpeedKms(v: number): void {
      outflowSpeedKms = v;
    },
    setParticleMassMsun(v: number): void {
      particleMassMsun = v;
    },
    setBurstPairs(v: number): void {
      burstPairs = v;
    },
    setLaunchSpreadKpc(v: number): void {
      launchSpreadKpc = v;
    },
    setOpeningAngleDeg(v: number): void {
      const x = Number(v);
      openingAngleDeg = Number.isFinite(x) ? Math.max(0, Math.min(55, x)) : 3;
    },
    setMode(v: OutflowMode): void {
      mode = v;
    },
    setDragStrength(v: number): void {
      dragStrength = v;
    },
    setGasProfile(v: GasProfile): void {
      gasProfile = v;
    },
    setGasDensityScaleMsunPerKpc3(v: number): void {
      gasDensityScaleMsunPerKpc3 = v;
    },
    setSingleExponent(v: number): void {
      singleExponent = v;
    },
    setGasSofteningKpc(v: number): void {
      gasSofteningKpc = v;
    },
    setDoubleRkneeKpc(v: number): void {
      doubleRkneeKpc = v;
    },
    setDoubleGamma1(v: number): void {
      doubleGamma1 = v;
    },
    setDoubleGamma2(v: number): void {
      doubleGamma2 = v;
    },

    setStreamActive(active: boolean): void {
      streamActive = active;
      if (active) {
        streamEjected = 0;
        streamTimeBank = 0;
        for (let b = 0; b < TURNAROUND_NBINS; b += 1) {
          turnaroundHist[b] = 0;
        }
        escapeNoTurnaround = 0;
      }
    },

    getSnapshot(): GalaxyOutflowSnapshot {
      const { rho0, rsKpc } = haloDerived();
      const kpp = kpcPerPixel();
      let maxSpeedKms = 0;
      const outParticles: OutflowParticle[] = particles.map((p) => {
        const s = magnitude(p.velocityKms);
        if (s > maxSpeedKms) {
          maxSpeedKms = s;
        }
        return {
          positionKpc: { ...p.positionKpc },
          velocityKms: { ...p.velocityKms },
          massMsun: p.massMsun,
          trailPx: p.trailPx.map((t) => ({ ...t })),
          upward: p.upward
        };
      });

      return {
        width: LOGICAL_WIDTH,
        height: LOGICAL_HEIGHT,
        centerPx,
        kpcPerPixel: kpp,
        nfwRsKpc: rsKpc,
        particles: outParticles,
        maxSpeedKms,
        activeCount: particles.length,
        derived: {
          nfwRho0MsunPerKpc3: rho0,
          rsKpc,
          rVirKpc,
          mDmVirMsun
        },
        streamEjected,
        streamMax: STREAM_MAX_PARTICLES,
        streamActive,
        turnaroundPdf: {
          binCounts: turnaroundHist.slice(),
          logRMin: TURNAROUND_LOG_R_MIN,
          logRMax: TURNAROUND_LOG_R_MAX,
          escapeCount: escapeNoTurnaround,
          nBins: TURNAROUND_NBINS
        }
      };
    }
  };
}
