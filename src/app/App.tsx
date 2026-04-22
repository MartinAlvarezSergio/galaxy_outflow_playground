import { useMemo } from "react";
import { AppletHostAdapter } from "../core/host";
import { GalaxyOutflowHaloCanvas } from "../applets/galaxy_outflow_halo/GalaxyOutflowHaloCanvas";

export function App(): JSX.Element {
  const host: AppletHostAdapter = useMemo(
    () => ({
      onClose: () => {},
      readReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    }),
    []
  );

  return (
    <div className="app-shell">
      <main>
        <section className="modal card">
          <GalaxyOutflowHaloCanvas host={host} />
        </section>
      </main>
    </div>
  );
}
