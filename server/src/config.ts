import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32))
  throw new Error("JWT_SECRET must be at least 32 characters in production");

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "rudis-dev-secret-change-me",
  dataDir: process.env.DATA_DIR ?? path.join(root, "data"),
  webDist: path.join(root, "web", "dist"),
  maxUploadBytes: 25 * 1024 * 1024,
  maxTotalUploadBytes: Number(process.env.MAX_TOTAL_UPLOAD_BYTES ?? 5 * 1024 * 1024 * 1024),
  messagePageSize: 50,
};
