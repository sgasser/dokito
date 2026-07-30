export type ErrorDetails = Record<string, unknown>;

export class DokitoError extends Error {
  readonly code: string;
  readonly details: ErrorDetails | undefined;

  constructor(code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "DokitoError";
    this.code = code;
    this.details = details;
  }
}

export function fail(
  condition: unknown,
  code: string,
  message: string,
  details?: ErrorDetails,
): asserts condition {
  if (!condition) {
    throw new DokitoError(code, message, details);
  }
}

export function normalizeError(error: unknown): DokitoError {
  if (error instanceof DokitoError) {
    return error;
  }

  if (error instanceof Error) {
    return new DokitoError("internal_error", error.message);
  }

  return new DokitoError("internal_error", String(error));
}
