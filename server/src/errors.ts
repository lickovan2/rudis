export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (what = "Не найдено") => new HttpError(404, what);
export const forbidden = (what = "Недостаточно прав") => new HttpError(403, what);
export const badRequest = (what: string) => new HttpError(400, what);
