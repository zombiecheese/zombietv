// JSON string helpers
// This codebase still stores several structured values as serialised JSON
// strings. These helpers keep parsing and serialisation consistent.

/** Serialise any value to a JSON string for DB storage. */
export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

/** Parse a JSON string from the DB. Returns `fallback` if the string is
 *  null, undefined, or invalid JSON. */
export function fromJson<T = unknown>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Convenience: parse a JSON string that is expected to be an object. */
export function fromJsonObject<T extends Record<string, unknown>>(
  raw: string | null | undefined,
): T {
  return fromJson<T>(raw, {} as T)
}

/** Convenience: parse a JSON string that is expected to be an array. */
export function fromJsonArray<T = unknown>(raw: string | null | undefined): T[] {
  return fromJson<T[]>(raw, [])
}
