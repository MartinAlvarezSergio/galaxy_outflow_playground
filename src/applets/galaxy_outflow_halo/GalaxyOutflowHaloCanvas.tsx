import { useEffect, useMemo, useRef, useState } from "react";
import { setLogicalTransform } from "../../core/canvasScale";
import { AppletHostAdapter } from "../../core/host";
import { AppletStage } from "../../ui/stage/AppletStage";
import { useCanvasBackingStore } from "../../ui/stage/hooks";
import {
  StageIconButton,
  StagePillButton,
  StagePills,
  StageReadout,
  StageSection,
  StageSelect,
  StageSlider,
  StageToggle
} from "../../ui/stage/StageControls";
import { GasProfile, OutflowMode } from "./types";
import {
  MW_C_NFW,
  MW_FIELD_HALF_KPC,
  MW_OPENING_ANGLE_DEG,
  MW_M_DM_VIR,
  MW_M_GALAXY_MSUN,
  MW_R_VIR_KPC,
  MW_V_OUT_KMS,
  MSUN_PER_KPC3_TO_G_PER_CM3,
  G_PER_CM3_TO_MSUN_PER_KPC3
} from "./units";
import { gasDensityAtCenter } from "./gasProfile";
import { renderGasDensityPlot } from "./gasDensityPlot";
import {
  renderTurnaroundPdfPlot,
  TURNAROUND_CAPTION_BAND,
  type TurnaroundPdfData
} from "./turnaroundPdfPlot";
import {
  escapeSpeedKmsHaloPlusMiyamotoNagai,
  MIYAMOTO_NAGAI_A_KPC,
  MIYAMOTO_NAGAI_B_KPC,
  nfwRho0FromMVir,
  nfwScaleRadius
} from "./halo";
import { createGalaxyOutflowSim, GRAV_PLUMMER_EPS_KPC, STREAM_MAX_PARTICLES } from "./sim";
import { renderGalaxyOutflow } from "./render";
import "./galaxyOutflowHalo.css";

type GalaxyOutflowHaloCanvasProps = {
  host?: AppletHostAdapter;
};

const M_DM_MIN = 4e11;
const M_DM_MAX = 2.2e12;
const LOG_M_DM_MIN = Math.log10(M_DM_MIN);
const LOG_M_DM_MAX = Math.log10(M_DM_MAX);
const R_VIR_MIN = 150;
const R_VIR_MAX = 280;
const C_MIN = 5;
const C_MAX = 20;
const M_GAL_MIN = 2e10;
const M_GAL_MAX = 1.2e11;
const LOG_M_GAL_MIN = Math.log10(M_GAL_MIN);
const LOG_M_GAL_MAX = Math.log10(M_GAL_MAX);
const FIELD_MIN = 28;
/** Allow up to ~0.5 × max r_vir slider (280 kpc) with a little headroom */
const FIELD_MAX = 160;
const TIME_RATE_MIN = 8;
const TIME_RATE_MAX = 150;
const V_OUT_MIN = 50;
const V_OUT_MAX = 2000;
const M_PART_LOG_MIN = 4;
const M_PART_LOG_MAX = 7.3;
const PAIRS_MIN = 1;
const PAIRS_MAX = 24;
const SPREAD_MIN = 0;
const SPREAD_MAX = 5;
const OPENING_MIN = 0;
const OPENING_MAX = 55;
const DRAG_MIN = 0;
const DRAG_MAX = 10;
/** log10(ρ [g/cm³]) at r = r_soft for the gas scale slider (~same range as former 10⁵–10^8.5 M☉/kpc³). */
const GAS_LOG_GCC_MIN = -28.25;
const GAS_LOG_GCC_MAX = -24.5;
const DEFAULT_GAS_LOG10_RHO0_GCC = Math.log10((10 ** 6.7) * MSUN_PER_KPC3_TO_G_PER_CM3);
const SINGLE_EXP_MIN = 0.2;
const SINGLE_EXP_MAX = 3.5;
const GAS_SOFT_MIN = 0.03;
const GAS_SOFT_MAX = 2.5;
const RK_MIN = 1;
const RK_MAX = 35;
const G1_MIN = 0.1;
const G1_MAX = 2.5;
const G2_MIN = 0.5;
const G2_MAX = 4;

/** Logical size of the main canvas; matches the simulation's pixel mapping in sim.ts. */
const CANVAS_W = 900;
const CANVAS_H = 620;
/** Logical size of the two inset plots (drawn 1:1 at the default inset width). */
const PLOT_W = 300;
const PLOT_H = 160;
/** Saved PDF images: same layout as the inset plus a caption strip, at 2× for sharp text. */
const EXPORT_SCALE = 2;
const MAX_STORED_PDF_SNAPSHOTS = 8;
/** Text readouts refresh at this interval; the canvases redraw every frame. */
const READOUT_INTERVAL_MS = 100;

const TIP = {
  play: "Start, pause or resume the clock. Settings and bursts still apply while paused.",
  clear: "Remove all tracers, stop the stream and empty the apocenter histogram. Settings stay as they are.",
  fire: "Launch a burst of tracer pairs (set by Burst pairs). Each pair leaves one point within the disk spread, one tracer up (+y) and one down (−y).",
  stream: `Emit tracer pairs continuously until stopped or ${STREAM_MAX_PARTICLES} tracers. Starting a stream clears the live apocenter histogram; stopping it saves the histogram below.`,
  trails: "Draw each tracer's recent path.",
  vectors: "Draw each tracer's velocity as a green line; longer = faster.",
  mDm: "Dark-matter mass inside the virial radius; with r_vir and c it sets the NFW density ρ₀.",
  rVir: "Virial radius of the halo. The dashed rings mark 0.2, 0.5 and 1 r_vir.",
  concentration: "NFW scale radius rₛ = r_vir / c. Higher c packs more of the halo mass towards the centre.",
  mGal: `Mass of the Miyamoto–Nagai disk standing in for the galaxy's baryons (fixed a = ${MIYAMOTO_NAGAI_A_KPC} kpc, b = ${MIYAMOTO_NAGAI_B_KPC} kpc).`,
  timeRate: "Simulated time per second of wall-clock time.",
  launchSpeed: "Launch speed of every tracer (all get the same |v|).",
  escape: `Sets launch |v| to v_esc on the disk midplane (y = 0) at in-plane radius r = max(0.2 kpc, disk spread), using the current NFW halo plus Miyamoto–Nagai disk (a = ${MIYAMOTO_NAGAI_A_KPC} kpc, b = ${MIYAMOTO_NAGAI_B_KPC} kpc).`,
  opening:
    "Full opening angle of the launch cone around the disk normal (±y), in the plane of the picture. Each tracer's direction is random within it; 0 = straight up and down.",
  tracerMass:
    "Mass of each tracer cloud. It only matters for drag: a heavier cloud has less area per mass (A/m ∝ m^(−1/3)), so it is slowed less. Dots grow with mass.",
  burstPairs: "Up/down tracer pairs launched by each Fire burst.",
  spread: "Half-width of the strip along the disk from which tracers are launched.",
  model: "Ballistic: gravity only.\nDrag: gravity plus ram-pressure deceleration by the halo gas.",
  drag:
    "a_drag = λ · Cd · ρ(r) · v² · (A/m). Tracer is a constant-density spherical cloud (A ∝ m^(2/3)); reference = 10⁵ M☉ @ 100 pc, Cd = 0.5. λ = 0 disables drag without changing the mode.",
  gasProfile: "Shape of the gas density ρ(r) that the drag uses.",
  singleExponent:
    "Single-power model uses ρ = ρ₀ (r_soft / r)ⁿ for r ≫ r_soft, i.e. ρ ∝ r⁻ⁿ; larger n means a steeper outward decline (the value is this n, not a “runaway” growth factor).",
  softening: "Inner floor r_soft: ρ(r) uses max(r, r_soft), so the power law stays finite at the centre.",
  rKnee: "Break radius of the double power law: ρ = ρ₀ x^(−γ₁) (1 + x)^(−(γ₂ − γ₁)), with x = r / r_break (r floored at r_soft).",
  gamma1: "Inner slope: ρ ∝ r^(−γ₁) well inside the break.",
  gamma2: "Outer slope: ρ ∝ r^(−γ₂) well outside the break.",
  activeTracers: "Tracers currently in flight.",
  maxSpeed: "Speed of the fastest tracer right now.",
  streamEjected: `Tracers launched by the current stream (cap ${STREAM_MAX_PARTICLES}).`,
  rs: "Derived NFW scale radius rₛ = r_vir / c.",
  rho0: "Derived NFW density ρ₀, set so the dark mass inside r_vir equals M_DM(r_vir).",
  gasPlot:
    "Gas density model: log10(ρ [g cm⁻³]) vs log10(r [kpc]). Dots are tracers at their radius and model ρ(r) (cyan launched up, orange down).",
  pdfPlot:
    "PDF of first apocenter radius (v_r: + to -). Top bar: escaped through r_max with no turnaround.\nStopping the stream (or hitting the eject cap) saves a PNG of this plot below; a new stream starts a fresh histogram.",
  snapshot: `Stored stream PDF snapshot (newest last, max ${MAX_STORED_PDF_SNAPSHOTS}).`
} as const;

type StoredPdfSnapshot = {
  id: string;
  dataUrl: string;
  label: string;
  pdfData: TurnaroundPdfData;
};

function newPdfSnapshotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  a.click();
}

function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").slice(0, 48);
}

function formatMsun(m: number): string {
  return `${m.toExponential(2)} M☉`;
}

function formatRhoGcc(log10rho: number): string {
  return `${(10 ** log10rho).toExponential(2)} g cm^-3`;
}

function formatHaloRho0(rho: number): string {
  return `${rho.toExponential(2)} M☉ kpc^-3`;
}

/** Render the apocenter PDF with a caption on an offscreen canvas, independent of the inset's size. */
function exportTurnaroundPdfPng(data: TurnaroundPdfData, caption: string): string {
  const h = PLOT_H + TURNAROUND_CAPTION_BAND;
  const canvas = document.createElement("canvas");
  canvas.width = PLOT_W * EXPORT_SCALE;
  canvas.height = h * EXPORT_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  setLogicalTransform(ctx, PLOT_W);
  renderTurnaroundPdfPlot(ctx, PLOT_W, h, data, { caption });
  return canvas.toDataURL("image/png");
}

export function GalaxyOutflowHaloCanvas({ host }: GalaxyOutflowHaloCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const plotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const turnaroundPlotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const plotGasRef = useRef({
    profile: "single_power" as GasProfile,
    rho0MsunPerKpc3: (10 ** DEFAULT_GAS_LOG10_RHO0_GCC) * G_PER_CM3_TO_MSUN_PER_KPC3,
    singleExponent: 1,
    gasSofteningKpc: 0.35,
    rKneeKpc: 8,
    gamma1: 0.5,
    gamma2: 2.2,
    rMinKpc: 0.05,
    rMaxKpc: 120
  });
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mDmVirMsun, setMDmVirMsun] = useState(MW_M_DM_VIR);
  const [rVirKpc, setRVirKpc] = useState(MW_R_VIR_KPC);
  const [concentration, setConcentration] = useState(MW_C_NFW);
  const [mGalaxyMsun, setMGalaxyMsun] = useState(MW_M_GALAXY_MSUN);
  const [fieldHalfWidthKpc, setFieldHalfWidthKpc] = useState(MW_FIELD_HALF_KPC);
  const [timeRateMyrPerSec, setTimeRateMyrPerSec] = useState(48);
  const [outflowSpeedKms, setOutflowSpeedKms] = useState(MW_V_OUT_KMS);
  const [particleMassMsun, setParticleMassMsun] = useState(2e5);
  const [burstPairs, setBurstPairs] = useState(8);
  const [launchSpreadKpc, setLaunchSpreadKpc] = useState(1.4);
  const [openingAngleDeg, setOpeningAngleDeg] = useState(MW_OPENING_ANGLE_DEG);
  const [mode, setMode] = useState<OutflowMode>("ballistic");
  const [dragStrength, setDragStrength] = useState(1);
  const [gasProfile, setGasProfile] = useState<GasProfile>("single_power");
  const [gasLogRhoGcc, setGasLogRhoGcc] = useState(DEFAULT_GAS_LOG10_RHO0_GCC);
  const [singleExponent, setSingleExponent] = useState(1);
  const [gasSofteningKpc, setGasSofteningKpc] = useState(0.35);
  const [doubleRkneeKpc, setDoubleRkneeKpc] = useState(8);
  const [doubleGamma1, setDoubleGamma1] = useState(0.5);
  const [doubleGamma2, setDoubleGamma2] = useState(2.2);
  const [showTrails, setShowTrails] = useState(true);
  const [showVectors, setShowVectors] = useState(false);
  const [maxSpeedKms, setMaxSpeedKms] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [streamEjected, setStreamEjected] = useState(0);
  const [streamActive, setStreamActive] = useState(false);
  const [storedPdfSnapshots, setStoredPdfSnapshots] = useState<StoredPdfSnapshot[]>([]);
  const prevStreamActiveRef = useRef(false);

  const reducedMotion = host?.readReducedMotion?.() ?? false;

  const gasDensityScaleMsunPerKpc3 = (10 ** gasLogRhoGcc) * G_PER_CM3_TO_MSUN_PER_KPC3;

  const gasRhoCenterMsunPerKpc3 = useMemo(
    () =>
      gasDensityAtCenter(
        gasProfile,
        gasDensityScaleMsunPerKpc3,
        singleExponent,
        gasSofteningKpc,
        doubleRkneeKpc,
        doubleGamma1,
        doubleGamma2
      ),
    [
      gasProfile,
      gasDensityScaleMsunPerKpc3,
      singleExponent,
      gasSofteningKpc,
      doubleRkneeKpc,
      doubleGamma1,
      doubleGamma2
    ]
  );
  const gasRhoCenterGcc = gasRhoCenterMsunPerKpc3 * MSUN_PER_KPC3_TO_G_PER_CM3;

  /* Same derived halo quantities the simulation uses (sim.ts haloDerived). */
  const derivedRs = nfwScaleRadius(rVirKpc, concentration);
  const derivedRho0 = nfwRho0FromMVir(mDmVirMsun, rVirKpc, concentration);

  const sim = useMemo(
    () =>
      createGalaxyOutflowSim({
        mDmVirMsun: MW_M_DM_VIR,
        rVirKpc: MW_R_VIR_KPC,
        concentration: MW_C_NFW,
        mGalaxyMsun: MW_M_GALAXY_MSUN,
        fieldHalfWidthKpc: MW_FIELD_HALF_KPC,
        timeRateMyrPerSec: 48,
        outflowSpeedKms: MW_V_OUT_KMS,
        particleMassMsun: 2e5,
        burstPairs: 8,
        launchSpreadKpc: 1.4,
        openingAngleDeg: MW_OPENING_ANGLE_DEG,
        mode: "ballistic",
        dragStrength: 1,
        gasProfile: "single_power",
        gasDensityScaleMsunPerKpc3: (10 ** DEFAULT_GAS_LOG10_RHO0_GCC) * G_PER_CM3_TO_MSUN_PER_KPC3,
        singleExponent: 1,
        gasSofteningKpc: 0.35,
        doubleRkneeKpc: 8,
        doubleGamma1: 0.5,
        doubleGamma2: 2.2
      }),
    []
  );

  // The plots are redrawn every frame, so a resize needs no extra repaint.
  useCanvasBackingStore([plotCanvasRef, turnaroundPlotCanvasRef]);

  useEffect(() => {
    sim.setMDmVirMsun(mDmVirMsun);
  }, [mDmVirMsun, sim]);
  useEffect(() => {
    sim.setRVirKpc(rVirKpc);
  }, [rVirKpc, sim]);
  useEffect(() => {
    sim.setConcentration(concentration);
  }, [concentration, sim]);
  useEffect(() => {
    sim.setMGalaxyMsun(mGalaxyMsun);
  }, [mGalaxyMsun, sim]);
  useEffect(() => {
    sim.setFieldHalfWidthKpc(fieldHalfWidthKpc);
  }, [fieldHalfWidthKpc, sim]);
  useEffect(() => {
    sim.setTimeRateMyrPerSec(timeRateMyrPerSec);
  }, [timeRateMyrPerSec, sim]);
  useEffect(() => {
    sim.setOutflowSpeedKms(outflowSpeedKms);
  }, [outflowSpeedKms, sim]);
  useEffect(() => {
    sim.setParticleMassMsun(particleMassMsun);
  }, [particleMassMsun, sim]);
  useEffect(() => {
    sim.setBurstPairs(burstPairs);
  }, [burstPairs, sim]);
  useEffect(() => {
    sim.setLaunchSpreadKpc(launchSpreadKpc);
  }, [launchSpreadKpc, sim]);
  useEffect(() => {
    sim.setOpeningAngleDeg(openingAngleDeg);
  }, [openingAngleDeg, sim]);
  useEffect(() => {
    sim.setMode(mode);
  }, [mode, sim]);
  useEffect(() => {
    sim.setDragStrength(dragStrength);
  }, [dragStrength, sim]);
  useEffect(() => {
    sim.setGasProfile(gasProfile);
  }, [gasProfile, sim]);
  useEffect(() => {
    sim.setGasDensityScaleMsunPerKpc3(gasDensityScaleMsunPerKpc3);
  }, [gasDensityScaleMsunPerKpc3, sim]);
  useEffect(() => {
    sim.setSingleExponent(singleExponent);
  }, [singleExponent, sim]);
  useEffect(() => {
    sim.setGasSofteningKpc(gasSofteningKpc);
  }, [gasSofteningKpc, sim]);
  useEffect(() => {
    sim.setDoubleRkneeKpc(doubleRkneeKpc);
  }, [doubleRkneeKpc, sim]);
  useEffect(() => {
    sim.setDoubleGamma1(doubleGamma1);
  }, [doubleGamma1, sim]);
  useEffect(() => {
    sim.setDoubleGamma2(doubleGamma2);
  }, [doubleGamma2, sim]);

  useEffect(() => {
    if (reducedMotion) {
      setShowTrails(false);
      setShowVectors(false);
    }
  }, [reducedMotion]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }

    let last = performance.now();
    let lastReadout = -Infinity;
    let raf = 0;
    const tick = (time: number): void => {
      const dt = (time - last) / 1000;
      last = time;
      if (running && !paused) {
        sim.step(dt);
      }
      const snapshot = sim.getSnapshot();
      setLogicalTransform(ctx, CANVAS_W);
      renderGalaxyOutflow(ctx, snapshot, { showTrails, showVectors });

      const plotCtx = plotCanvasRef.current?.getContext("2d");
      if (plotCtx) {
        const particles = snapshot.particles.map((p) => ({
          rKpc: Math.hypot(p.positionKpc.x, p.positionKpc.y),
          upward: p.upward
        }));
        setLogicalTransform(plotCtx, PLOT_W);
        renderGasDensityPlot(plotCtx, PLOT_W, PLOT_H, plotGasRef.current, particles);
      }

      const pdfRaw = snapshot.turnaroundPdf;
      const pdfData: TurnaroundPdfData = {
        binCounts: pdfRaw.binCounts.slice(),
        logRMin: pdfRaw.logRMin,
        logRMax: pdfRaw.logRMax,
        escapeCount: pdfRaw.escapeCount,
        nBins: pdfRaw.nBins
      };
      const turnCtx = turnaroundPlotCanvasRef.current?.getContext("2d");
      if (turnCtx) {
        setLogicalTransform(turnCtx, PLOT_W);
        renderTurnaroundPdfPlot(turnCtx, PLOT_W, PLOT_H, pdfData);
      }

      // Stopping the stream (or reaching its cap) saves this run's PDF for comparison.
      const streamJustEnded = prevStreamActiveRef.current && !snapshot.streamActive;
      prevStreamActiveRef.current = snapshot.streamActive;
      if (streamJustEnded) {
        const total = pdfData.binCounts.reduce((a, b) => a + b, 0) + pdfData.escapeCount;
        if (total > 0) {
          const modeBit = mode === "drag" ? `drag λ=${dragStrength.toFixed(1)}` : "ballistic";
          const caption = `${modeBit} · ${snapshot.streamEjected} tracers · ${new Date().toLocaleString()}`;
          const dataUrl = exportTurnaroundPdfPng(pdfData, caption);
          const label = `${modeBit} · ${snapshot.streamEjected} tr · ${new Date().toLocaleTimeString()}`;
          if (dataUrl) {
            setStoredPdfSnapshots((prev) =>
              [...prev, { id: newPdfSnapshotId(), dataUrl, label, pdfData }].slice(-MAX_STORED_PDF_SNAPSHOTS)
            );
          }
        }
      }

      if (streamJustEnded || time - lastReadout > READOUT_INTERVAL_MS) {
        lastReadout = time;
        setMaxSpeedKms(snapshot.maxSpeedKms);
        setActiveCount(snapshot.activeCount);
        setStreamEjected(snapshot.streamEjected);
      }
      setStreamActive(snapshot.streamActive);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, running, showTrails, showVectors, sim, mode, dragStrength]);

  function onPlayPause(): void {
    if (!running) {
      setRunning(true);
      setPaused(false);
    } else {
      setPaused((v) => !v);
    }
  }

  function onReset(): void {
    sim.reset();
    host?.onResult?.({ event: "reset" });
  }

  function onFire(): void {
    sim.fireBurst();
    if (!running) {
      setRunning(true);
    }
  }

  function onToggleStream(): void {
    if (streamActive) {
      sim.setStreamActive(false);
    } else {
      sim.setStreamActive(true);
      setRunning(true);
    }
  }

  function applyEscapeVelocity(): void {
    const rsKpc = nfwScaleRadius(rVirKpc, concentration);
    const rho0 = nfwRho0FromMVir(mDmVirMsun, rVirKpc, concentration);
    const rEval = Math.max(0.2, launchSpreadKpc);
    const v = escapeSpeedKmsHaloPlusMiyamotoNagai(
      rEval,
      0,
      rho0,
      rsKpc,
      mGalaxyMsun,
      MIYAMOTO_NAGAI_A_KPC,
      MIYAMOTO_NAGAI_B_KPC
    );
    const clamped = Math.min(V_OUT_MAX, Math.max(V_OUT_MIN, Math.round(v)));
    setOutflowSpeedKms(clamped);
  }

  const mDmSlider =
    (Math.log10(mDmVirMsun) - LOG_M_DM_MIN) / (LOG_M_DM_MAX - LOG_M_DM_MIN);
  const mGalSlider =
    (Math.log10(mGalaxyMsun) - LOG_M_GAL_MIN) / (LOG_M_GAL_MAX - LOG_M_GAL_MIN);
  const mPartSlider = (Math.log10(particleMassMsun) - M_PART_LOG_MIN) / (M_PART_LOG_MAX - M_PART_LOG_MIN);

  plotGasRef.current = {
    profile: gasProfile,
    rho0MsunPerKpc3: gasDensityScaleMsunPerKpc3,
    singleExponent,
    gasSofteningKpc,
    rKneeKpc: doubleRkneeKpc,
    gamma1: doubleGamma1,
    gamma2: doubleGamma2,
    rMinKpc: 0.05,
    rMaxKpc: Math.max(120, fieldHalfWidthKpc * 2.5)
  };

  const moving = running && !paused;
  const playLabel = moving ? "Pause" : running ? "Resume" : "Start";
  const dragOff = mode !== "drag";
  const streamStatus = streamActive ? "(on)" : streamEjected >= STREAM_MAX_PARTICLES ? "(cap reached)" : "";

  const toolbar = (
    <>
      <StageIconButton icon={moving ? "pause" : "play"} label={playLabel} tip={TIP.play} onClick={onPlayPause} />
      <StageIconButton icon="trash" label="Clear" tip={TIP.clear} onClick={onReset} />
      <StagePillButton label="Fire burst" tip={TIP.fire} onClick={onFire} />
      <StageToggle
        label={streamActive ? "Stop stream" : "Start stream"}
        on={streamActive}
        tip={TIP.stream}
        onChange={onToggleStream}
      />
    </>
  );

  const controls = (
    <>
      <StagePills>
        <StageToggle label="Trails" on={showTrails} tip={TIP.trails} onChange={setShowTrails} />
        <StageToggle label="Velocity vectors" on={showVectors} tip={TIP.vectors} onChange={setShowVectors} />
      </StagePills>

      <StageSection title="Halo + galaxy mass">
        <StageSlider
          label="M_DM(r_vir) total dark halo (log scale)"
          display={formatMsun(mDmVirMsun)}
          value={Number.isFinite(mDmSlider) ? mDmSlider : 0.5}
          min={0}
          max={1}
          step={0.002}
          tip={TIP.mDm}
          onChange={(t) => setMDmVirMsun(10 ** (LOG_M_DM_MIN + t * (LOG_M_DM_MAX - LOG_M_DM_MIN)))}
        />
        <StageSlider
          label="r_vir"
          display={`${Math.round(rVirKpc)} kpc`}
          value={rVirKpc}
          min={R_VIR_MIN}
          max={R_VIR_MAX}
          step={1}
          tip={TIP.rVir}
          onChange={setRVirKpc}
        />
        <StageSlider
          label="NFW concentration c = r_vir/rₛ"
          display={concentration.toFixed(1)}
          value={concentration}
          min={C_MIN}
          max={C_MAX}
          step={0.5}
          tip={TIP.concentration}
          onChange={setConcentration}
        />
        <StageSlider
          label="M_baryons (MN disk mass, log scale)"
          display={formatMsun(mGalaxyMsun)}
          value={Number.isFinite(mGalSlider) ? mGalSlider : 0.5}
          min={0}
          max={1}
          step={0.005}
          tip={TIP.mGal}
          onChange={(t) => setMGalaxyMsun(10 ** (LOG_M_GAL_MIN + t * (LOG_M_GAL_MAX - LOG_M_GAL_MIN)))}
        />
      </StageSection>

      <StageSection title="Outflow properties">
        <StageSlider
          label="Field half-width (center → edge)"
          display={`${fieldHalfWidthKpc.toFixed(0)} kpc`}
          value={fieldHalfWidthKpc}
          min={FIELD_MIN}
          max={FIELD_MAX}
          step={1}
          tip={`Distance from the centre to the left/right edge of the view; 0.5 r_vir ≈ ${(0.5 * rVirKpc).toFixed(0)} kpc. Tracers beyond max(2.5 × this, 120 kpc) are removed and, without a turnaround, counted as escaped.`}
          onChange={setFieldHalfWidthKpc}
        />
        <StageSlider
          label="Time rate"
          display={`${timeRateMyrPerSec.toFixed(0)} Myr / s`}
          value={timeRateMyrPerSec}
          min={TIME_RATE_MIN}
          max={TIME_RATE_MAX}
          step={1}
          tip={TIP.timeRate}
          onChange={setTimeRateMyrPerSec}
        />
        <StageSlider
          label="Launch speed (|v|)"
          display={`${Math.round(outflowSpeedKms)} km/s`}
          value={outflowSpeedKms}
          min={V_OUT_MIN}
          max={V_OUT_MAX}
          step={1}
          tip={TIP.launchSpeed}
          onChange={setOutflowSpeedKms}
        />
        <StagePills>
          <StagePillButton label="Escape velocity" tip={TIP.escape} onClick={applyEscapeVelocity} />
        </StagePills>
        <StageSlider
          label="Opening angle (full cone, in-plane around +/-disk normal)"
          display={`${openingAngleDeg.toFixed(1)} deg`}
          value={openingAngleDeg}
          min={OPENING_MIN}
          max={OPENING_MAX}
          step={0.5}
          tip={TIP.opening}
          onChange={(v) => {
            setOpeningAngleDeg(v);
            sim.setOpeningAngleDeg(v);
          }}
        />
        <StageSlider
          label="Tracer mass (drag, log scale)"
          display={formatMsun(particleMassMsun)}
          value={Number.isFinite(mPartSlider) ? mPartSlider : 0.5}
          min={0}
          max={1}
          step={0.004}
          tip={TIP.tracerMass}
          onChange={(t) => setParticleMassMsun(10 ** (M_PART_LOG_MIN + t * (M_PART_LOG_MAX - M_PART_LOG_MIN)))}
        />
        <StageSlider
          label="Burst pairs"
          display={String(burstPairs)}
          value={burstPairs}
          min={PAIRS_MIN}
          max={PAIRS_MAX}
          step={1}
          tip={TIP.burstPairs}
          onChange={setBurstPairs}
        />
        <StageSlider
          label="Disk spread (half-width)"
          display={`${launchSpreadKpc.toFixed(2)} kpc`}
          value={launchSpreadKpc}
          min={SPREAD_MIN}
          max={SPREAD_MAX}
          step={0.05}
          tip={TIP.spread}
          onChange={setLaunchSpreadKpc}
        />
        <StageSelect
          label="Outflow model"
          value={mode}
          options={[
            { value: "ballistic", label: "Ballistic (no drag)" },
            { value: "drag", label: "Drag = λ · Cd · ρ · v² · A/m (ram pressure)" }
          ]}
          tip={TIP.model}
          onChange={setMode}
        />
      </StageSection>

      {/* Opens when drag mode is chosen (its controls only act in drag mode); it can still be toggled by hand. */}
      <StageSection title="Drag" defaultOpen={!dragOff}>
        <StageSlider
          label="Drag strength λ (ram-pressure multiplier)"
          display={dragStrength.toFixed(2)}
          value={dragStrength}
          min={DRAG_MIN}
          max={DRAG_MAX}
          step={0.05}
          disabled={dragOff}
          tip={TIP.drag}
          onChange={setDragStrength}
        />
        <StageSelect
          label="Gas ρ(r) for drag"
          value={gasProfile}
          options={[
            { value: "single_power", label: "Single power law" },
            { value: "double_power", label: "Double power law" }
          ]}
          disabled={dragOff}
          tip={TIP.gasProfile}
          onChange={setGasProfile}
        />
        <StageSlider
          label="Gas ρ₀ reference (log₁₀ g cm⁻³ at r = r_soft)"
          display={formatRhoGcc(gasLogRhoGcc)}
          value={gasLogRhoGcc}
          min={GAS_LOG_GCC_MIN}
          max={GAS_LOG_GCC_MAX}
          step={0.05}
          disabled={dragOff}
          tip={`log₁₀ ρ₀ = ${gasLogRhoGcc.toFixed(2)} → ${formatRhoGcc(gasLogRhoGcc)} (${gasDensityScaleMsunPerKpc3.toExponential(2)} M☉ kpc⁻³).`}
          onChange={setGasLogRhoGcc}
        />
        {gasProfile === "single_power" ? (
          <>
            <StageSlider
              label="Radial slope n in ρ ∝ r⁻ⁿ (r ≫ r_soft)"
              display={singleExponent.toFixed(2)}
              value={singleExponent}
              min={SINGLE_EXP_MIN}
              max={SINGLE_EXP_MAX}
              step={0.05}
              disabled={dragOff}
              tip={TIP.singleExponent}
              onChange={setSingleExponent}
            />
            <StageSlider
              label="Softening rₛ"
              display={`${gasSofteningKpc.toFixed(2)} kpc`}
              value={gasSofteningKpc}
              min={GAS_SOFT_MIN}
              max={GAS_SOFT_MAX}
              step={0.01}
              disabled={dragOff}
              tip={TIP.softening}
              onChange={setGasSofteningKpc}
            />
          </>
        ) : (
          <>
            <StageSlider
              label="Break rₛ"
              display={`${doubleRkneeKpc.toFixed(1)} kpc`}
              value={doubleRkneeKpc}
              min={RK_MIN}
              max={RK_MAX}
              step={0.5}
              disabled={dragOff}
              tip={TIP.rKnee}
              onChange={setDoubleRkneeKpc}
            />
            <StageSlider
              label="γ₁ (inner)"
              display={doubleGamma1.toFixed(2)}
              value={doubleGamma1}
              min={G1_MIN}
              max={G1_MAX}
              step={0.05}
              disabled={dragOff}
              tip={TIP.gamma1}
              onChange={setDoubleGamma1}
            />
            <StageSlider
              label="γ₂ (outer)"
              display={doubleGamma2.toFixed(2)}
              value={doubleGamma2}
              min={G2_MIN}
              max={G2_MAX}
              step={0.05}
              disabled={dragOff}
              tip={TIP.gamma2}
              onChange={setDoubleGamma2}
            />
          </>
        )}
        <StageReadout
          label="Gas ρ at inner floor"
          value={`${gasRhoCenterGcc.toExponential(3)} g cm⁻³`}
          muted={dragOff}
          tip={`Gas ρ at inner floor (r = r_soft from the halo/galaxy center): ${gasRhoCenterGcc.toExponential(3)} g cm⁻³ (${gasRhoCenterMsunPerKpc3.toExponential(3)} M☉ kpc⁻³).\nr_soft is spherical radius from that same origin (not an offset from the disk); it caps r in ρ(r) so the power laws stay finite.`}
        />
      </StageSection>
    </>
  );

  const readouts = (
    <>
      <StageReadout label="Active tracers" value={activeCount} tip={TIP.activeTracers} />
      <StageReadout label="Max |v|" value={`${maxSpeedKms.toFixed(0)} km/s`} tip={TIP.maxSpeed} />
      <StageReadout
        label="Stream ejected"
        value={
          <>
            {streamEjected} / {STREAM_MAX_PARTICLES}
            {streamStatus ? <span className="outflow-stream-status"> {streamStatus}</span> : null}
          </>
        }
        valueColor={streamActive ? "#9be4ff" : undefined}
        tip={TIP.streamEjected}
      />
      <StageReadout label="NFW rₛ" value={`${derivedRs.toFixed(1)} kpc`} muted tip={TIP.rs} />
      <StageReadout label="NFW ρ₀" value={formatHaloRho0(derivedRho0)} muted tip={TIP.rho0} />
    </>
  );

  const inset = (
    <div className="outflow-plots">
      <div title={TIP.gasPlot} data-hover-help={TIP.gasPlot}>
        <canvas
          ref={plotCanvasRef}
          role="img"
          aria-label="Gas density model with tracers at their radius"
          style={{ aspectRatio: `${PLOT_W} / ${PLOT_H}` }}
        />
      </div>
      <div title={TIP.pdfPlot} data-hover-help={TIP.pdfPlot}>
        <canvas
          ref={turnaroundPlotCanvasRef}
          role="img"
          aria-label="Distribution of the radius of first apocenter, and the escaped fraction"
          style={{ aspectRatio: `${PLOT_W} / ${PLOT_H}` }}
        />
      </div>
    </div>
  );

  const info = (
    <>
      <h4>Reading the picture</h4>
      <ul>
        <li>Cyan tracers were launched up (+y), orange ones down (−y); dots grow with tracer mass.</li>
        <li>
          Dashed orange rings: 0.2, 0.5 and 1 r_vir. Faint rings: steps of rₛ/2. Red ring: 0.02 r_vir, inside which
          infalling tracers are removed.
        </li>
        <li>Top right: derived NFW rₛ = r_vir / c and ρ₀ (set so the dark mass inside r_vir is M_DM).</li>
      </ul>
      <h4>Plots</h4>
      <ul>
        <li>Upper: gas density model, log10(ρ [g cm⁻³]) vs log10(r [kpc]). Dots are tracers at their radius and model ρ(r).</li>
        <li>
          Lower: PDF of first apocenter radius (v_r: + to −). Top bar: escaped through r_max = max(2.5 × field
          half-width, 120 kpc) with no turnaround.
        </li>
        <li>
          When you stop the stream or hit the eject cap ({STREAM_MAX_PARTICLES}), a PNG of this plot is saved below for
          comparison (e.g. ballistic vs drag); the newest {MAX_STORED_PDF_SNAPSHOTS} are kept. Starting a new stream
          clears the live histogram so each run is independent.
        </li>
      </ul>
      <h4>Model</h4>
      <ul>
        <li>
          Same launch |v| for every tracer; direction is random within the opening-angle cone around ±y (disk normal).
          Motion is followed in the plane of the picture.
        </li>
        <li>
          Gravity: NFW halo + Miyamoto–Nagai disk (fixed a = {MIYAMOTO_NAGAI_A_KPC} kpc, b = {MIYAMOTO_NAGAI_B_KPC} kpc,
          vertical scale height). Tracers feel it but have no gravity of their own. The halo pull is Plummer-softened (ε = {GRAV_PLUMMER_EPS_KPC} kpc).
        </li>
        <li>
          Escape velocity: v_esc on the disk midplane (y = 0) at in-plane radius r = max(0.2 kpc, disk spread), for the
          current halo and disk.
        </li>
        <li>
          Drag mode adds gas deceleration, a_drag = λ · Cd · ρ(r) · v² · (A/m), on constant-density spherical clouds
          (A ∝ m^(2/3); reference 10⁵ M☉ @ 100 pc, Cd = 0.5). The gas is a fixed ρ(r) at rest; λ = 0 disables drag.
        </li>
        <li>
          Gas ρ(r) uses max(r, r_soft), a spherical radius from the centre (not an offset from the disk), so the power
          laws stay finite.
        </li>
        <li>Units: kpc, M☉, km/s, Myr; 1 M☉ = 1.98847×10^33 g, 1 kpc = 3.085677581×10^21 cm.</li>
      </ul>
    </>
  );

  const below =
    storedPdfSnapshots.length > 0 ? (
      <div className="outflow-snapshots">
        <div className="outflow-snapshot-grid">
          {storedPdfSnapshots.map((s) => (
            <figure key={s.id} className="outflow-snapshot-card" title={TIP.snapshot}>
              <img src={s.dataUrl} alt={s.label} />
              <figcaption>{s.label}</figcaption>
              <div className="outflow-snapshot-actions">
                <button
                  type="button"
                  onClick={() => downloadDataUrl(s.dataUrl, `galaxy-outflow-pdf-${sanitizeFilenamePart(s.id)}.png`)}
                >
                  PNG
                </button>
                <button
                  type="button"
                  onClick={() => downloadJson(s.pdfData, `galaxy-outflow-pdf-${sanitizeFilenamePart(s.id)}.json`)}
                >
                  JSON
                </button>
                <button type="button" onClick={() => setStoredPdfSnapshots((prev) => prev.filter((x) => x.id !== s.id))}>
                  Remove
                </button>
              </div>
            </figure>
          ))}
        </div>
        <button type="button" className="outflow-snapshots-clear" onClick={() => setStoredPdfSnapshots([])}>
          Clear all snapshots
        </button>
      </div>
    ) : null;

  return (
    <AppletStage
      logicalWidth={CANVAS_W}
      logicalHeight={CANVAS_H}
      canvasRef={canvasRef}
      canvasLabel="Outflow tracers launched from a disk galaxy inside its dark-matter halo"
      toolbar={toolbar}
      controls={controls}
      readouts={readouts}
      inset={inset}
      info={info}
      play={{ visible: !running || paused, label: playLabel, onClick: onPlayPause }}
      below={below}
      rootClassName="outflow-stage"
    />
  );
}
