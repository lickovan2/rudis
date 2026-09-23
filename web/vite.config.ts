import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.RUDIS_BACKEND ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": backend,
      "/uploads": backend,
      "/socket.io": { target: backend, ws: true },
    },
  },
});
