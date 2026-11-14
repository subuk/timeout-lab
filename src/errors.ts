// Keep a translatable explanation separate from the original diagnostics.
export class DiagnosticError extends Error {
  constructor(
    message: string,
    public readonly details: string,
  ) {
    super(message);
    this.name = "DiagnosticError";
  }
}

export function errorDetails(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
