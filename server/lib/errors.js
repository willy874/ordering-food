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

/**
 * 取出 Postgres 的 SQLSTATE。
 *
 * Drizzle 會把驅動層的錯誤包成 DrizzleQueryError（訊息帶著完整 SQL 與參數），
 * 真正的 pg 錯誤放在 cause 裡，因此要往下找。
 */
export function pgErrorCode(err) {
  for (let current = err; current; current = current.cause) {
    if (typeof current.code === 'string') return current.code;
  }
  return undefined;
}

/** Postgres unique_violation */
export const isUniqueViolation = (err) => pgErrorCode(err) === '23505';

/** 包住 async route handler，讓丟出的錯誤能進到 error middleware */
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
