/**
 * Errors with an HTTP status and a stable machine-readable code. The app's
 * error handler turns them into `{ message, code }` responses; the frontend
 * translates by `code`.
 */
export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message || code);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Not signed in') =>
  new HttpError(401, 'unauthenticated', message);
export const forbidden = (message = 'Missing or insufficient permissions') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') =>
  new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code, message) => new HttpError(409, code, message);
