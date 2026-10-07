import 'server-only'

/** Thrown by repository skeleton functions (WP-1.1). Replaced by real queries in the WP that owns each table. */
export class NotImplementedError extends Error {
  constructor(name: string, argCount: number) {
    super(`Repository function not implemented: ${name} (${argCount} args)`)
    this.name = 'NotImplementedError'
  }
}

export function notImplemented(name: string, args: readonly unknown[]): never {
  throw new NotImplementedError(name, args.length)
}
