/**
 * Next.js App Router: in some versions/builds, `params` in route handlers may be a Promise.
 * Always resolve before reading dynamic segment values.
 */
export async function resolveAppRouteParams(params) {
  const resolved = await Promise.resolve(params ?? {});
  return resolved && typeof resolved === "object" ? resolved : {};
}

export async function getAppRouteParamString(params, key) {
  const resolved = await resolveAppRouteParams(params);
  const raw = resolved?.[key];
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "string" && first.trim() ? first.trim() : undefined;
  }
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
