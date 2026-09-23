import type { Attachment } from "./types";

// В десктопе и при раздаче с того же сервера адрес пустой — запросы идут на текущий origin.
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

const TOKEN_KEY = "rudis.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим — живём без сохранения */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Ошибка ${res.status}`);
  return data as T;
}

export function uploadFile(file: File, onProgress?: (p: number) => void): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_BASE + "/api/upload");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* пусто */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error ?? "Не удалось загрузить файл"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Нет связи с сервером"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export const fileUrl = (url: string | null | undefined) =>
  url ? API_BASE + url + (url.startsWith("/uploads/") ? "?v=2" : "") : undefined;
