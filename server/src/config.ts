import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "rudis-dev-secret-change-me",
  dataDir: process.env.DATA_DIR ?? path.join(root, "data"),
  webDist: path.join(root, "web", "dist"),
  maxUploadBytes: 25 * 1024 * 1024,
  messagePageSize: 50,
};
