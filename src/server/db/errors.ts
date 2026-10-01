import "server-only";

/**
 * An expected failure of a command (a rule was broken, not a bug). Services
 * throw it; actions map `code` to a result and never let it reach the client
 * as an exception.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
