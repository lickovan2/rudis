import type { z } from "zod";
import { badRequest } from "./errors.ts";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Неверные данные");
  return r.data;
}
