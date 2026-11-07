/**
 * Awaits `promise` and returns its rejection as `{ error }`, or `null` when it fulfils. Lets components handle
 * a failed request without try/catch, which the React Compiler cannot compile around conditionals.
 */
export async function failure(promise: Promise<unknown>): Promise<{ error: unknown } | null> {
  try {
    await promise
    return null
  } catch (error) {
    return { error }
  }
}

/** Like `failure`, but keeps the value: `{ ok: true, value }` or `{ ok: false, error }`. */
export async function attempt<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}
