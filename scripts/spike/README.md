# scripts/spike

One-off verification scripts for 04 section 11 (not shipped). All start with `requireDevEnv()` (dev project only) and never print secrets.
Run from the repository root. Record results in the 04 section 11 result fields and 10 "計測結果".
They have NOT been executed yet (DB connection is not available as of 2026-10-08).

| Script | 04 section 11 item | Needs |
|---|---|---|
| u2-prepare.ts | U2 | DB connection (#3, #7) |
| d2-app-runtime.ts | D2 | DB connection + app_runtime role (#8) |
| s3-connections.ts | S3 | DB connection + running server |
| d1-signed-upload.ts | D1, D6, U8 | Supabase keys + bucket `files` (#3, #6, #7) |
| d12-bucket.ts | D12 | migration DB URL + Supabase keys |
