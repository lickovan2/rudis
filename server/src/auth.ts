import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.ts";
import { HttpError } from "./errors.ts";
import { one } from "./db.ts";

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "30d" });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string };
    if (!payload.sub) return null;
    return one("SELECT id FROM users WHERE id = ?", payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

const mediaCookie = "rudis.media";

export function setMediaCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  const secure = req.protocol === "https" ? "; Secure" : "";
  reply.header("Set-Cookie", `${mediaCookie}=${token}; HttpOnly; SameSite=Strict; Path=/uploads; Max-Age=2592000${secure}`);
}

export function clearMediaCookie(req: FastifyRequest, reply: FastifyReply) {
  const secure = req.protocol === "https" ? "; Secure" : "";
  reply.header("Set-Cookie", `${mediaCookie}=; HttpOnly; SameSite=Strict; Path=/uploads; Max-Age=0${secure}`);
}

export function mediaUserId(req: FastifyRequest): string | null {
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${mediaCookie}=`));
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7) : null;
  return verifyToken(bearer ?? cookie?.slice(mediaCookie.length + 1) ?? "");
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export async function requireAuth(req: FastifyRequest) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = token && verifyToken(token);
  if (!userId) throw new HttpError(401, "Требуется вход");
  req.userId = userId;
}
