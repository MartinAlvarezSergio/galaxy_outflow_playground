import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/galaxy_outflow_playground/",
  plugins: [react()]
});
