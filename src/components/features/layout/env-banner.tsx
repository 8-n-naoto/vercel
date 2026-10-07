// 08 3.5 non-production environment banner (D-016). Server Component: no 'use client', no NEXT_PUBLIC_.
// The root layout reads APP_ENV, turns it into a label with envBannerLabel and passes only the label here.

export type AppEnvName = 'local' | 'test' | 'production'

// 08 9.4 B-01 / B-02
const LABELS: Record<Exclude<AppEnvName, 'production'>, string> = {
  local: 'ローカル環境',
  test: 'テスト環境',
}

/** Label for the banner, or null when nothing must be rendered (production). */
export function envBannerLabel(appEnv: AppEnvName): string | null {
  return appEnv === 'production' ? null : LABELS[appEnv]
}

export function EnvBanner({ label }: { label: string | null }) {
  if (label === null) return null
  // Not sticky / fixed: it only sits at the top of the page. Black text on amber keeps contrast (08 8 A-11).
  return (
    <div role="note" aria-label="環境" className="flex h-6 w-full shrink-0 items-center justify-center bg-amber-400 text-xs text-black">
      {label}
    </div>
  )
}
