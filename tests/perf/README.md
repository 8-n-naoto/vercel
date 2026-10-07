# tests/perf: 性能測定スクリプト

作成: performance-tester（T-048、2026-10-08）。**すべて未実行**（テスト環境が無いため。スクリプトの構文は読んだだけで k6 では未検証）。
対象はテスト環境（Vercel Preview + 開発用 Supabase）のみ。本番・共有環境には向けない。目標値は D-011（02 §9.1 NF-01〜NF-25）。

## 前提（導入は人間 / infra-sre。`npm install` はしない）

| ツール | 用途 | 現状 | 導入 |
|---|---|---|---|
| k6 | 負荷（5 → 10 → 20 同時） | 未導入 | https://grafana.com/docs/k6/ の手順（Windows: `winget install k6` か `choco install k6`）。npm の依存にはしない |
| curl | 単発 TTFB・配信 | あり（Git Bash） | 不要 |
| Lighthouse + Chrome | Web Vitals | 未導入 | `npx lighthouse`（Chrome 本体が要る）。手順は `lighthouse.md` |

`ab` は使わない（Cookie 付き Server Action の対（action → raw）を表現できない）。

## 環境変数（値はリポジトリに書かない。シェルで設定する）

| 変数 | 内容 |
|---|---|
| `PERF_APP_ORIGIN` | テスト環境のアプリ用ホストの origin |
| `PERF_CONTENT_ORIGIN` | テスト環境のコンテンツ用ホストの origin（`/raw` 用。別ホスト） |
| `PERF_COOKIE` | ログイン済みテストユーザーの Cookie ヘッダー値。seed ユーザー（`npm run seed`）でログインして取得する。ログに出さない |
| `PERF_FOLDER_ID` / `PERF_FILE_ID` | 閲覧できるフォルダ / ファイル（約 100KB と約 1MB の 2 種を用意する） |
| `PERF_LARGE_FILE_ID` | 約 50MB の active なファイル |
| `PERF_ACTION_ID_OPEN` | `view.openAsMember` の Next-Action ID。**ビルドごとに変わる**。デプロイしたコミットで `npm run build` し、`.next/server/server-reference-manifest.json` の `exportedName` が `viewOpenAsMember` のキー（`7f` で始まる 42 桁程度の 16 進）を使う。ブラウザの DevTools（Network の `Next-Action` ヘッダー）でも取れる |
| `PERF_STAGE_HOLD` | 各段階の保持時間（既定 `2m`） |

## スクリプトと実行順

| 順 | スクリプト | 測るもの | NF | 負荷 |
|---|---|---|---|---|
| 1 | `curl/ttfb.sh` | 各ページの TTFB（初回 = コールド / 以降 = ウォーム） | NF-09, NF-10 | 逐次のみ |
| 2 | `lighthouse.md` の手順 | LCP / CLS / TBT / アセットサイズ | （NF-09 の補助） | 単発 |
| 3 | `k6/pages.js` | 一覧 / 詳細 / `/view` の TTFB 分布を 5 → 10 → 20 同時で | NF-02, NF-09 | 小（HTML のみ） |
| 4 | `k6/view-raw.js` | `openAsMember` → `/raw` の対。閲覧開始までの時間 | NF-02, NF-11 | 中（ファイルサイズ × 回数） |
| 5 | `curl/raw-stream.sh` | 1 回の閲覧開始。`2500k` で 20Mbps 相当 | NF-11, NF-12 | 1 回 = ファイルサイズ |
| 6 | `k6/raw-large.js` | 50MB の配信（開始までの時間、完了時間） | NF-12, NF-08 | **1 回 約 50MB** |
| 7 | Vercel のログ / Supabase ダッシュボード | 関数の実行時間・メモリ、egress の増分、Query Performance | NF-12, NF-08, NF-14 | なし |

段階実行の例（失敗したらそこで止める。どの段階で目標を割ったかを記録する）:

```bash
k6 run -e PERF_STAGE_HOLD=1m --out json=tests/perf/results/pages-$(date +%Y%m%d-%H%M).json tests/perf/k6/pages.js
```

## 守る制約

- **レート制限**: `/raw` は IP あたり 120 回 / 分（`raw:ip`）、Server Action はユーザーあたり 120 回 / 分（`mutation:user`）。20 同時で 1 VU あたり 10 秒に 1 回の対にすると 120 回 / 分でちょうど上限になる。429 は `rate_limited_429` として別集計し、性能の失敗には数えない（上限に達したことは結果に書く）。
- **閲覧ログ**: `openAsMember` は呼ぶたびに `access_logs` に 1 行入る（保持 180 日）。測定後にテスト用フォルダごと削除するか、`npm run seed:cleanup` を使う。
- **Supavisor**: 関数 1 インスタンスの接続は最大 3（`src/server/db/client.ts`）。同時 20 でインスタンスが増えると Free の接続上限に当たりうる。エラー率の上昇（500 / `INTERNAL`）が出たらその段階で止め、Supabase のログで接続数を確認する。
- **負荷を上げる前に egress を確認**: Supabase ダッシュボードの Usage で前後の値を記録する（runbook §10 の月間 egress 確認手順）。

## egress の見積もり（Supabase Free 5GB / 月に対する消費）

| 測定 | 条件 | 概算 |
|---|---|---|
| ttfb.sh | 5 ページ × 11 回、HTML のみ | 数 MB 以下（Storage を通らない。DB 応答のみ） |
| k6/pages.js | 保持 1 分、HTML のみ | 数十 MB 以下 |
| k6/view-raw.js | 100KB ファイル、保持 1 分、約 275 回 | 約 30MB |
| k6/view-raw.js | 1MB ファイル、NF-11 判定用に 5 同時で 30 回に絞る（`PERF_STAGE_HOLD` ではなく別途 `--vus 5 --iterations 30`） | 約 30MB |
| curl/raw-stream.sh | 50MB × 最大 3 回 | 約 150MB |
| k6/raw-large.js | 50MB × 3 回 | 約 150MB |
| 合計（全部実施） | | 約 0.4GB（月間枠の 8%）。WP-5.4 の 50MB 確認（最大 3 回 = 150MB）と合算しても 0.55GB 程度 |

1MB ファイルで同じラダーを回すと約 0.5GB を使うので、ラダーには 100KB を使い、1MB は NF-11 の判定用に絞る。

## 結果の記録先

- 生データ（k6 の JSON、CSV）: `tests/perf/results/`（コミットしない。報告には貼らず、パスと日時だけ書く）
- 要約: `docs/agents/reports/T-xxx-performance-tester.md` と `docs/agents/coverage.md` の「性能」表
- 目標未達は `docs/agents/findings/F-xxx.md`
