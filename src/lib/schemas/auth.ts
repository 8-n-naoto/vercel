// Input schemas of the auth Actions (06 4). Shared by client and server.
import { z } from 'zod'
import { zEmail, zNextPath } from './common'

export const authSignInInput = z
  .object({
    email: zEmail,
    password: z.string().min(1).max(72),
    next: zNextPath.nullable().default(null),
  })
  .strict()

export type AuthSignInInput = z.input<typeof authSignInInput>
