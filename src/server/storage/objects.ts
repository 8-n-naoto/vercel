// Storage adapter (06 7.7). Services use only these functions; they never call the Supabase SDK directly.
// Errors carry the operation name only: signed URLs, keys and SDK messages are never put into messages.
import 'server-only'
import { createBucketClient } from './supabase-storage-client'

export type ObjectsOp = 'createSignedUploadUrl' | 'stat' | 'readHead' | 'openStream' | 'remove' | 'removeMany' | 'listAll'

export class ObjectsError extends Error {
  readonly op: ObjectsOp
  constructor(op: ObjectsOp) {
    super(`storage operation failed: ${op}`)
    this.name = 'ObjectsError'
    this.op = op
  }
}

export type RemoveResult = { removed: string[]; failed: string[] }
export type ObjectStat = { size: number; mimeType: string }
export type ObjectStream = { status: number; body: ReadableStream<Uint8Array>; contentLength: number | null }

export interface ObjectsAdapter {
  createSignedUploadUrl(path: string): Promise<{ signedUrl: string }>
  stat(path: string): Promise<ObjectStat | null>
  readHead(path: string, bytes: number): Promise<Uint8Array>
  openStream(path: string): Promise<ObjectStream>
  remove(path: string): Promise<RemoveResult>
  removeMany(paths: string[]): Promise<RemoveResult>
  listAll(): AsyncIterable<{ path: string; size: number }>
}

type SdkError = { message?: string } | null
type ListedObject = { name: string; id: string | null; metadata: { size?: number; mimetype?: string } | null }

/** The subset of the SDK bucket API used here (structural, so tests can pass a small mock). */
export interface BucketApi {
  createSignedUploadUrl(path: string): Promise<{ data: { signedUrl: string } | null; error: SdkError }>
  createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: SdkError }>
  info(path: string): Promise<{ data: { size?: number; contentType?: string } | null; error: SdkError }>
  list(path?: string, options?: { limit?: number; offset?: number; search?: string }): Promise<{ data: ListedObject[] | null; error: SdkError }>
  remove(paths: string[]): Promise<{ data: unknown[] | null; error: SdkError }>
}

export type ObjectsDeps = { bucket: () => BucketApi; fetch: typeof fetch }

const SIGNED_URL_SECONDS = 60
const REMOVE_CHUNK = 100
const LIST_LIMIT = 1000

async function signedUrl(api: BucketApi, path: string, op: ObjectsOp): Promise<string> {
  const { data, error } = await api.createSignedUrl(path, SIGNED_URL_SECONDS)
  if (error || !data) throw new ObjectsError(op)
  return data.signedUrl
}

async function fetchSafe(deps: ObjectsDeps, url: string, init: RequestInit | undefined, op: ObjectsOp): Promise<Response> {
  try {
    return await deps.fetch(url, init)
  } catch {
    throw new ObjectsError(op) // the original error may embed the signed URL
  }
}

/** Reads at most `bytes` bytes and cancels the rest (handles servers that ignore Range and answer 200 with the whole body). */
async function readUpTo(body: ReadableStream<Uint8Array>, bytes: number): Promise<Uint8Array> {
  const reader = body.getReader()
  const out = new Uint8Array(bytes)
  let filled = 0
  try {
    while (filled < bytes) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, bytes - filled)
      out.set(value.subarray(0, take), filled)
      filled += take
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return out.slice(0, filled)
}

async function statByList(api: BucketApi, path: string): Promise<ObjectStat | null> {
  const i = path.lastIndexOf('/')
  const dir = i < 0 ? '' : path.slice(0, i)
  const name = i < 0 ? path : path.slice(i + 1)
  const { data, error } = await api.list(dir, { search: name, limit: 100 })
  if (error || !data) throw new ObjectsError('stat')
  const hit = data.find((o) => o.name === name && o.id !== null)
  if (!hit || !hit.metadata) return null
  return { size: hit.metadata.size ?? 0, mimeType: hit.metadata.mimetype ?? '' }
}

export function createObjectsAdapter(deps: ObjectsDeps): ObjectsAdapter {
  async function removeMany(paths: string[]): Promise<RemoveResult> {
    const removed: string[] = []
    const failed: string[] = []
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
      const chunk = paths.slice(i, i + REMOVE_CHUNK)
      try {
        // A path that does not exist is not reported by the SDK and counts as removed (idempotent).
        const { error } = await deps.bucket().remove(chunk)
        if (error) failed.push(...chunk)
        else removed.push(...chunk)
      } catch {
        failed.push(...chunk)
      }
    }
    return { removed, failed }
  }

  async function* walk(prefix: string): AsyncGenerator<{ path: string; size: number }> {
    for (let offset = 0; ; offset += LIST_LIMIT) {
      const { data, error } = await deps.bucket().list(prefix, { limit: LIST_LIMIT, offset })
      if (error || !data) throw new ObjectsError('listAll')
      for (const o of data) {
        const path = prefix === '' ? o.name : `${prefix}/${o.name}`
        if (o.id === null) yield* walk(path) // folder placeholder
        else yield { path, size: o.metadata?.size ?? 0 }
      }
      if (data.length < LIST_LIMIT) return
    }
  }

  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await deps.bucket().createSignedUploadUrl(path)
      if (error || !data) throw new ObjectsError('createSignedUploadUrl')
      return { signedUrl: data.signedUrl }
    },

    async stat(path) {
      const api = deps.bucket()
      const info = await api.info(path).catch(() => null)
      if (info && !info.error && info.data) {
        return { size: info.data.size ?? 0, mimeType: info.data.contentType ?? '' }
      }
      // info missing (older SDK) or the object was not found: confirm through list (06 7.7).
      return statByList(api, path)
    },

    async readHead(path, bytes) {
      const url = await signedUrl(deps.bucket(), path, 'readHead')
      const res = await fetchSafe(deps, url, { headers: { Range: `bytes=0-${bytes - 1}` } }, 'readHead')
      if ((res.status !== 206 && res.status !== 200) || !res.body) {
        await res.body?.cancel().catch(() => undefined)
        throw new ObjectsError('readHead')
      }
      return readUpTo(res.body, bytes) // 206: small body; 200: first `bytes` bytes, rest cancelled
    },

    async openStream(path) {
      const url = await signedUrl(deps.bucket(), path, 'openStream')
      const res = await fetchSafe(deps, url, undefined, 'openStream')
      if (!res.body) throw new ObjectsError('openStream')
      const len = res.headers.get('content-length')
      const n = len === null ? NaN : Number(len)
      return { status: res.status, body: res.body, contentLength: Number.isFinite(n) ? n : null }
    },

    remove: (path) => removeMany([path]),
    removeMany,
    listAll: () => walk(''),
  }
}

let cached: ObjectsAdapter | undefined

/** The production adapter (created lazily so importing this module does not read the configuration). */
export function getObjects(): ObjectsAdapter {
  cached ??= createObjectsAdapter({ bucket: createBucketClient, fetch: (input, init) => fetch(input, init) })
  return cached
}
