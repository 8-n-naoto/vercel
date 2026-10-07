// Input schemas of the file Actions (06 7.1 - 7.6). Shared by client and server; the backend must not change them.
import { z } from 'zod'
import { zCharset, zNullableIsoDateTime, zTrimmed, zUuid } from './common'

export const filesStartUploadInput = z
  .object({
    folderId: zUuid,
    originalFilename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((n) => /\.html?$/i.test(n), 'extension')
      .refine((n) => !/[/\\]/.test(n) && !/[\u0000-\u001f\u007f]/.test(n), 'invalid_chars'),
    displayName: zTrimmed(1, 200).nullable().default(null), // null -> file name without the extension (200 chars max)
    sizeBytes: z.number().int().min(1), // the upper limit is compared on the server (MAX_FILE_SIZE_MB)
    contentType: z.string().max(100), // File.type; only '' and 'text/html' are accepted (checked on the server)
  })
  .strict()

export const filesFinalizeUploadInput = z.object({ fileId: zUuid }).strict()
export const filesCancelUploadInput = z.object({ fileId: zUuid }).strict()

export const filesUpdateInput = z
  .object({ fileId: zUuid, displayName: zTrimmed(1, 200).optional(), charset: zCharset.optional() })
  .strict()
  .refine((v) => v.displayName !== undefined || v.charset !== undefined, 'empty')

export const filesUpdateRestrictionsInput = z
  .object({
    fileId: zUuid,
    suspended: z.boolean(),
    viewStartsAt: zNullableIsoDateTime,
    viewEndsAt: zNullableIsoDateTime,
    expiresAt: zNullableIsoDateTime,
    downloadAllowed: z.boolean(),
  })
  .strict()
  .refine((v) => !v.viewStartsAt || !v.viewEndsAt || new Date(v.viewStartsAt) < new Date(v.viewEndsAt), {
    path: ['viewEndsAt'],
    message: 'ends_before_starts',
  })

export const filesDeleteInput = z.object({ fileId: zUuid }).strict()

export type FilesStartUploadInput = z.input<typeof filesStartUploadInput>
export type FilesFinalizeUploadInput = z.input<typeof filesFinalizeUploadInput>
export type FilesCancelUploadInput = z.input<typeof filesCancelUploadInput>
export type FilesUpdateInput = z.input<typeof filesUpdateInput>
export type FilesUpdateRestrictionsInput = z.input<typeof filesUpdateRestrictionsInput>
export type FilesDeleteInput = z.input<typeof filesDeleteInput>
