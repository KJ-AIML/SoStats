/** postgres-js error codes may be wrapped by Drizzle; walk the cause chain. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (
      candidate.code === '23505' &&
      candidate.constraint_name === constraint
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
