import { useEffect, useMemo, useRef, useState } from "react";
import { AppletHostAdapter } from "../../core/host";
import { ControlCard } from "../../ui/ControlCard";
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
  type TurnaroundPdfData
} from "./turnaroundPdfPlot";
import {
  escapeSpeedKmsHaloPlusMiyamotoNagai,
  MIYAMOTO_NAGAI_A_KPC,
  MIYAMOTO_NAGAI_B_KPC,
  nfwRho0FromMVir,
  nfwScaleRadius
} from "./halo";
import { createGalaxyOutflowSim, STREAM_MAX_PARTICLES } from "./sim";
import { renderGalaxyOutflow } from "./render";

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

const PLOT_W = 900;
const PLOT_H = 240;
const PLOT_TURN_H = 220;
const MAX_STORED_PDF_SNAPSHOTS = 8;

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
  return s.replace(/[^\w.\-]+/g, "_").slice(0, 48);
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
  const [derivedRho0, setDerivedRho0] = useState(0);
  const [derivedRs, setDerivedRs] = useState(0);
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
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let last = performance.now();
    let raf = 0;
    const tick = (time: number): void => {
      const dt = (time - last) / 1000;
      last = time;
      if (running && !paused) {
        sim.step(dt);
      }
      const snapshot = sim.getSnapshot();
      renderGalaxyOutflow(ctx, snapshot, { showTrails, showVectors });

      const plotCanvas = plotCanvasRef.current;
      const plotCtx = plotCanvas?.getContext("2d");
      if (plotCanvas && plotCtx) {
        const g = plotGasRef.current;
        const particles = snapshot.particles.map((p) => ({
          rKpc: Math.hypot(p.positionKpc.x, p.positionKpc.y),
          upward: p.upward
        }));
        renderGasDensityPlot(plotCtx, plotCanvas.width, plotCanvas.height, g, particles);
      }

      const turnCanvas = turnaroundPlotCanvasRef.current;
      const turnCtx = turnCanvas?.getContext("2d");
      if (turnCanvas && turnCtx) {
        const pdfRaw = snapshot.turnaroundPdf;
        const pdfData: TurnaroundPdfData = {
          binCounts: pdfRaw.binCounts.slice(),
          logRMin: pdfRaw.logRMin,
          logRMax: pdfRaw.logRMax,
          escapeCount: pdfRaw.escapeCount,
          nBins: pdfRaw.nBins
        };
        const streamJustEnded = prevStreamActiveRef.current && !snapshot.streamActive;
        prevStreamActiveRef.current = snapshot.streamActive;

        renderTurnaroundPdfPlot(turnCtx, turnCanvas.width, turnCanvas.height, pdfData);

        if (streamJustEnded) {
          const total =
            pdfData.binCounts.reduce((a, b) => a + b, 0) + pdfData.escapeCount;
          if (total > 0) {
            const modeBit =
              mode === "drag"
                ? `drag λ=${dragStrength.toFixed(1)}`
                : "ballistic";
            const caption = `${modeBit} · ${snapshot.streamEjected} tracers · ${new Date().toLocaleString()}`;
            renderTurnaroundPdfPlot(turnCtx, turnCanvas.width, turnCanvas.height, pdfData, {
              caption
            });
            const dataUrl = turnCanvas.toDataURL("image/png");
            renderTurnaroundPdfPlot(turnCtx, turnCanvas.width, turnCanvas.height, pdfData);
            const label = `${modeBit} · ${snapshot.streamEjected} tr · ${new Date().toLocaleTimeString()}`;
            setStoredPdfSnapshots((prev) => {
              const next: StoredPdfSnapshot[] = [
                ...prev,
                {
                  id: newPdfSnapshotId(),
                  dataUrl,
                  label,
                  pdfData
                }
              ];
              return next.slice(-MAX_STORED_PDF_SNAPSHOTS);
            });
          }
        }
      }

      setMaxSpeedKms(snapshot.maxSpeedKms);
      setActiveCount(snapshot.activeCount);
      setDerivedRho0(snapshot.derived.nfwRho0MsunPerKpc3);
      setDerivedRs(snapshot.derived.rsKpc);
      setStreamEjected(snapshot.streamEjected);
      setStreamActive(snapshot.streamActive);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, running, showTrails, showVectors, sim, mode, dragStrength]);

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

  return (
    <div className="gravity-layout">
      <ControlCard
        title="Galaxy outflow vs. halo (MW-like)"
        subtitle="Same launch |v|; direction is random within the opening-angle cone around +/-y (disk normal). NFW halo + Miyamoto–Nagai disk (fixed a, b) accelerate tracers (no tracer gravity). Drag mode adds gas deceleration."
      >
        <div className="control-grid">
          <div className="button-row control-span-2">
            <button type="button" onClick={() => setRunning(true)}>
              Start
            </button>
            <button type="button" onClick={() => setPaused((v) => !v)} disabled={!running}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" onClick={onReset}>
              Clear
            </button>
            <button type="button" onClick={onFire}>
              Fire burst
            </button>
            <button type="button" onClick={onToggleStream}>
              {streamActive ? "Stop stream" : "Start stream"}
            </button>
          </div>

          <div className="stats control-span-2">
            <div>
              Active tracers: <strong>{activeCount}</strong>
            </div>
            <div>
              Max |v|: <strong>{maxSpeedKms.toFixed(0)} km/s</strong>
            </div>
            <div>
              Stream ejected:{" "}
              <strong>
                {streamEjected} / {STREAM_MAX_PARTICLES}
              </strong>
              {streamActive ? " (on)" : streamEjected >= STREAM_MAX_PARTICLES ? " (cap reached)" : ""}
            </div>
          </div>

          <details className="control-section control-span-2" open>
            <summary>Halo + galaxy mass</summary>
            <div className="control-grid" style={{ marginTop: "0.65rem" }}>
              <label className="control-span-2">
                <span className="slider-label">
                  <span>M_DM(r_vir) total dark halo (log scale)</span>
                  <strong>{formatMsun(mDmVirMsun)}</strong>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.002}
                  value={Number.isFinite(mDmSlider) ? mDmSlider : 0.5}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setMDmVirMsun(10 ** (LOG_M_DM_MIN + t * (LOG_M_DM_MAX - LOG_M_DM_MIN)));
                  }}
                />
              </label>

              <label>
                <span className="slider-label">
                  <span>r_vir</span>
                  <strong>{Math.round(rVirKpc)} kpc</strong>
                </span>
                <input
                  type="range"
                  min={R_VIR_MIN}
                  max={R_VIR_MAX}
                  value={rVirKpc}
                  onChange={(e) => setRVirKpc(Number(e.target.value))}
                />
              </label>

              <label>
                <span className="slider-label">
                  <span>NFW concentration c = r_vir/rₛ</span>
                  <strong>{concentration.toFixed(1)}</strong>
                </span>
                <input
                  type="range"
                  min={C_MIN}
                  max={C_MAX}
                  step={0.5}
                  value={concentration}
                  onChange={(e) => setConcentration(Number(e.target.value))}
                />
              </label>

              <label className="control-span-2">
                <span className="slider-label">
                  <span>M_baryons (MN disk mass, log scale)</span>
                  <strong>{formatMsun(mGalaxyMsun)}</strong>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.005}
                  value={Number.isFinite(mGalSlider) ? mGalSlider : 0.5}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setMGalaxyMsun(10 ** (LOG_M_GAL_MIN + t * (LOG_M_GAL_MAX - LOG_M_GAL_MIN)));
                  }}
                />
              </label>

              <div className="stats control-span-2 subtle" style={{ fontSize: "0.82rem" }}>
                Derived NFW: rₛ = <strong>{derivedRs.toFixed(1)} kpc</strong>, ρ₀ ={" "}
                <strong>{formatHaloRho0(derivedRho0)}</strong>. Disk: Miyamoto–Nagai a = {MIYAMOTO_NAGAI_A_KPC}{" "}
                kpc, b = {MIYAMOTO_NAGAI_B_KPC} kpc (vertical scale height).
              </div>
            </div>
          </details>

          <details className="control-section control-span-2" open>
            <summary>Outflow properties</summary>
            <div className="control-grid" style={{ marginTop: "0.65rem" }}>
          <label>
            <span className="slider-label">
              <span>Field half-width (center → edge)</span>
              <strong>
                {fieldHalfWidthKpc.toFixed(0)} kpc
                <span className="subtle" style={{ fontWeight: 400, fontSize: "0.85em" }}>
                  {" "}
                  · 0.5 r_vir ≈ {(0.5 * rVirKpc).toFixed(0)} kpc
                </span>
              </strong>
            </span>
            <input
              type="range"
              min={FIELD_MIN}
              max={FIELD_MAX}
              value={fieldHalfWidthKpc}
              onChange={(e) => setFieldHalfWidthKpc(Number(e.target.value))}
            />
          </label>

          <label>
            <span className="slider-label">
              <span>Time rate</span>
              <strong>{timeRateMyrPerSec.toFixed(0)} Myr / s</strong>
            </span>
            <input
              type="range"
              min={TIME_RATE_MIN}
              max={TIME_RATE_MAX}
              value={timeRateMyrPerSec}
              onChange={(e) => setTimeRateMyrPerSec(Number(e.target.value))}
            />
          </label>

          <label className="control-span-2">
            <span className="slider-label">
              <span>Launch speed (|v|)</span>
              <strong>{Math.round(outflowSpeedKms)} km/s</strong>
            </span>
            <input
              type="range"
              min={V_OUT_MIN}
              max={V_OUT_MAX}
              value={outflowSpeedKms}
              onChange={(e) => setOutflowSpeedKms(Number(e.target.value))}
            />
          </label>

          <div className="control-span-2">
            <button type="button" onClick={applyEscapeVelocity}>
              Escape velocity
            </button>
            <div className="subtle" style={{ fontSize: "0.78rem", marginTop: "0.35rem", lineHeight: 1.4 }}>
              Sets launch |v| to v_esc on the disk midplane (y = 0) at in-plane radius r = max(0.2 kpc, disk
              spread), using the current NFW halo plus Miyamoto–Nagai disk (a = {MIYAMOTO_NAGAI_A_KPC} kpc, b ={" "}
              {MIYAMOTO_NAGAI_B_KPC} kpc).
            </div>
          </div>

          <label className="control-span-2">
            <span className="slider-label">
              <span>Opening angle (full cone, in-plane around +/-disk normal)</span>
              <strong>{openingAngleDeg.toFixed(1)} deg</strong>
            </span>
            <input
              type="range"
              min={OPENING_MIN}
              max={OPENING_MAX}
              step={0.5}
              value={openingAngleDeg}
              onChange={(e) => {
                const v = Number(e.target.value);
                setOpeningAngleDeg(v);
                sim.setOpeningAngleDeg(v);
              }}
            />
          </label>

          <label>
            <span className="slider-label">
              <span>Tracer mass (drag, log scale)</span>
              <strong>{formatMsun(particleMassMsun)}</strong>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.004}
              value={Number.isFinite(mPartSlider) ? mPartSlider : 0.5}
              onChange={(e) => {
                const t = Number(e.target.value);
                const logM = M_PART_LOG_MIN + t * (M_PART_LOG_MAX - M_PART_LOG_MIN);
                setParticleMassMsun(10 ** logM);
              }}
            />
          </label>

          <label>
            <span className="slider-label">
              <span>Burst pairs</span>
              <strong>{burstPairs}</strong>
            </span>
            <input
              type="range"
              min={PAIRS_MIN}
              max={PAIRS_MAX}
              value={burstPairs}
              onChange={(e) => setBurstPairs(Number(e.target.value))}
            />
          </label>

          <label className="control-span-2">
            <span className="slider-label">
              <span>Disk spread (half-width)</span>
              <strong>{launchSpreadKpc.toFixed(2)} kpc</strong>
            </span>
            <input
              type="range"
              min={SPREAD_MIN}
              max={SPREAD_MAX}
              step={0.05}
              value={launchSpreadKpc}
              onChange={(e) => setLaunchSpreadKpc(Number(e.target.value))}
            />
          </label>

          <label className="control-span-2">
            <span className="slider-label">Outflow model</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as OutflowMode)}
            >
              <option value="ballistic">Ballistic (no drag)</option>
              <option value="drag">Drag = λ · Cd · ρ · v² · A/m (ram pressure)</option>
            </select>
          </label>
            </div>
          </details>

          <details className="control-section control-span-2" open>
            <summary>Drag</summary>
            <div className="control-grid" style={{ marginTop: "0.65rem" }}>
          <label className="control-span-2">
            <span className="slider-label">
              <span>Drag strength λ (ram-pressure multiplier)</span>
              <strong>{dragStrength.toFixed(2)}</strong>
            </span>
            <span
              className="subtle"
              style={{ fontSize: "0.78rem", display: "block", marginBottom: "0.35rem", lineHeight: 1.4 }}
            >
              a_drag = λ · Cd · ρ(r) · v² · (A/m). Tracer is a constant-density spherical cloud
              (A ∝ m^(2/3)); reference = 10⁵ M☉ @ 100 pc, Cd = 0.5. λ = 0 disables drag without changing the mode.
            </span>
            <input
              type="range"
              min={DRAG_MIN}
              max={DRAG_MAX}
              step={0.05}
              value={dragStrength}
              onChange={(e) => setDragStrength(Number(e.target.value))}
              disabled={mode !== "drag"}
            />
          </label>

          <label className="control-span-2">
            <span className="slider-label">Gas ρ(r) for drag</span>
            <select
              value={gasProfile}
              onChange={(e) => setGasProfile(e.target.value as GasProfile)}
              disabled={mode !== "drag"}
            >
              <option value="single_power">Single power law</option>
              <option value="double_power">Double power law</option>
            </select>
          </label>

          <label className="control-span-2">
            <span className="slider-label">
              <span>Gas ρ₀ reference (log₁₀ g cm⁻³ at r = r_soft)</span>
              <strong>
                {gasLogRhoGcc.toFixed(2)} → {formatRhoGcc(gasLogRhoGcc)} (
                {(gasDensityScaleMsunPerKpc3).toExponential(2)} M☉ kpc⁻³)
              </strong>
            </span>
            <input
              type="range"
              min={GAS_LOG_GCC_MIN}
              max={GAS_LOG_GCC_MAX}
              step={0.05}
              value={gasLogRhoGcc}
              onChange={(e) => setGasLogRhoGcc(Number(e.target.value))}
              disabled={mode !== "drag"}
            />
          </label>

          {gasProfile === "single_power" ? (
            <>
              <label className="control-span-2">
                <span className="slider-label">
                  <span>Radial slope n in ρ ∝ r⁻ⁿ (r ≫ r_soft)</span>
                  <strong>{singleExponent.toFixed(2)}</strong>
                </span>
                <span className="subtle" style={{ fontSize: "0.78rem", display: "block", marginBottom: "0.35rem" }}>
                  Single-power model uses ρ = ρ₀ (r_soft / r)ⁿ for r ≫ r_soft, i.e. ρ ∝ r⁻ⁿ; larger n means a
                  steeper outward decline (the value is this n, not a “runaway” growth factor).
                </span>
                <input
                  type="range"
                  min={SINGLE_EXP_MIN}
                  max={SINGLE_EXP_MAX}
                  step={0.05}
                  value={singleExponent}
                  onChange={(e) => setSingleExponent(Number(e.target.value))}
                  disabled={mode !== "drag"}
                />
              </label>
              <label>
                <span className="slider-label">
                  <span>Softening rₛ</span>
                  <strong>{gasSofteningKpc.toFixed(2)} kpc</strong>
                </span>
                <input
                  type="range"
                  min={GAS_SOFT_MIN}
                  max={GAS_SOFT_MAX}
                  step={0.01}
                  value={gasSofteningKpc}
                  onChange={(e) => setGasSofteningKpc(Number(e.target.value))}
                  disabled={mode !== "drag"}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                <span className="slider-label">
                  <span>Break rₛ</span>
                  <strong>{doubleRkneeKpc.toFixed(1)} kpc</strong>
                </span>
                <input
                  type="range"
                  min={RK_MIN}
                  max={RK_MAX}
                  step={0.5}
                  value={doubleRkneeKpc}
                  onChange={(e) => setDoubleRkneeKpc(Number(e.target.value))}
                  disabled={mode !== "drag"}
                />
              </label>
              <label>
                <span className="slider-label">
                  <span>γ₁ (inner)</span>
                  <strong>{doubleGamma1.toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={G1_MIN}
                  max={G1_MAX}
                  step={0.05}
                  value={doubleGamma1}
                  onChange={(e) => setDoubleGamma1(Number(e.target.value))}
                  disabled={mode !== "drag"}
                />
              </label>
              <label className="control-span-2">
                <span className="slider-label">
                  <span>γ₂ (outer)</span>
                  <strong>{doubleGamma2.toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={G2_MIN}
                  max={G2_MAX}
                  step={0.05}
                  value={doubleGamma2}
                  onChange={(e) => setDoubleGamma2(Number(e.target.value))}
                  disabled={mode !== "drag"}
                />
              </label>
            </>
          )}

          <div className="control-span-2 subtle" style={{ fontSize: "0.82rem", lineHeight: 1.45 }}>
            Gas ρ at inner floor (r = r_soft from the halo/galaxy center):{" "}
            <strong>{gasRhoCenterGcc.toExponential(3)} g cm⁻³</strong> (
            {gasRhoCenterMsunPerKpc3.toExponential(3)} M☉ kpc⁻³).
            <br />
            <span style={{ opacity: 0.92 }}>
              r_soft is spherical radius from that same origin (not an offset from the disk); it caps r in
              ρ(r) so the power laws stay finite. Conversion: 1 M☉ = 1.98847×10^33 g, 1 kpc = 3.085677581×10^21
              cm.
            </span>
          </div>
            </div>
          </details>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={showTrails}
              onChange={(e) => setShowTrails(e.target.checked)}
            />
            Trails
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showVectors}
              onChange={(e) => setShowVectors(e.target.checked)}
            />
            Velocity vectors
          </label>
        </div>
      </ControlCard>

      <div className="galaxy-outflow-visual-column">
        <div className="canvas-shell card">
          <canvas ref={canvasRef} width={900} height={620} />
        </div>
        <div className="canvas-shell card galaxy-outflow-density-plot">
          <div className="subtle" style={{ marginBottom: "0.45rem" }}>
            Gas density model: log10(ρ [g cm⁻³]) vs log10(r [kpc]). Dots are tracers at their radius and model
            ρ(r).
          </div>
          <canvas ref={plotCanvasRef} width={PLOT_W} height={PLOT_H} />
        </div>
        <div className="canvas-shell card galaxy-outflow-density-plot">
          <div className="subtle" style={{ marginBottom: "0.45rem" }}>
            PDF of first apocenter radius (v_r: + to -). Top bar: escaped through r_max with no turnaround.
            When you stop the stream or hit the eject cap, a PNG of this plot is saved below for comparison
            (e.g. ballistic vs drag). Starting a new stream clears the live histogram so each run is independent.
          </div>
          <canvas ref={turnaroundPlotCanvasRef} width={PLOT_W} height={PLOT_TURN_H} />
          {storedPdfSnapshots.length > 0 ? (
            <div style={{ marginTop: "0.65rem" }}>
              <div className="subtle" style={{ marginBottom: "0.35rem" }}>
                Stored stream PDF snapshots (newest last). Max {MAX_STORED_PDF_SNAPSHOTS}.
              </div>
              <div className="galaxy-outflow-pdf-snapshots">
                {storedPdfSnapshots.map((s) => (
                  <div key={s.id} className="pdf-snapshot-card">
                    <img src={s.dataUrl} alt={s.label} />
                    <div className="subtle" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
                      {s.label}
                    </div>
                    <div className="pdf-snapshot-actions">
                      <button
                        type="button"
                        onClick={() =>
                          downloadDataUrl(
                            s.dataUrl,
                            `galaxy-outflow-pdf-${sanitizeFilenamePart(s.id)}.png`
                          )
                        }
                      >
                        PNG
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadJson(
                            s.pdfData,
                            `galaxy-outflow-pdf-${sanitizeFilenamePart(s.id)}.json`
                          )
                        }
                      >
                        JSON
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setStoredPdfSnapshots((prev) => prev.filter((x) => x.id !== s.id))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                style={{ marginTop: "0.5rem", fontSize: "0.82rem" }}
                onClick={() => setStoredPdfSnapshots([])}
              >
                Clear all snapshots
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
