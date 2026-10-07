// src/instrumentation.ts
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  // err.digest is the ID shown to the user by error.tsx; never log request bodies, headers or query strings.
  const digest = typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : undefined
  const name = err instanceof Error ? err.name : 'unknown'
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'request.error',
      digest,
      error: name,
      stack: err instanceof Error ? err.stack : undefined,
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
    }),
  )
}
