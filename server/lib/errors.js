export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const unauthorized = (msg = '沒有權限') => new HttpError(403, msg);
export const notFound = (msg = '找不到資料') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Postgres unique_violation */
export const isUniqueViolation = (err) => err?.code === '23505';

/** 包住 async route handler，讓丟出的錯誤能進到 error middleware */
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
