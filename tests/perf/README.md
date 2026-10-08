# tests/perf: 性能測定スクリプト

作成: performance-tester（T-048、2026-10-08）。`k6/view-raw.js` は T-057（同日）で複数利用者・レート制限対応に変更。**すべて未実行**（テスト環境が無いため。スクリプトの構文は読んだだけで k6 では未検証）。
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
| `PERF_COOKIE` | ログイン済みテストユーザー 1 名の Cookie ヘッダー値。`ttfb.sh` / `pages.js` / `raw-large.js` / `raw-stream.sh` が使う。ログに出さない |
| `PERF_COOKIE_1` 〜 `PERF_COOKIE_20` | `view-raw.js` 用。**別々のメンバー**のログイン Cookie（1 から連番）。VU k は `((k-1) mod N)+1` 番を使う。未設定なら `PERF_COOKIE` 1 名で動く（その場合は下の予算検査で 20 同時の段階は中止になる）。ログに出さない |
| `PERF_PACE_SEC` / `PERF_MODE` | `view-raw.js` の 1 反復の間隔（既定 12 秒）/ 実行モード（`ladder` 既定、`nf11`、`limit-check`） |
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

- **レート制限**（06 §3.5）: `/raw` は IP あたり 120 回 / 分（`raw:ip`）、`openAsMember` は利用者あたり 30 回 / 分（`ticket:user`、D-022）、Server Action 全般は利用者あたり 120 回 / 分（`mutation:user`）。`view-raw.js` はこの範囲に収まるよう設計してあり、超えると中止する（下の「view-raw.js の設計」）。上限に当たった応答は `rate_limited_429` として別集計し、エラー率（`view_error_rate`、NF-26）にも遅延にも混ぜない。注意: Server Action の上限超過は **HTTP 429 ではなく HTTP 200 + 本文の `RATE_LIMITED`**（`define-action.ts` が `{ ok: false, error }` を返す）。`/raw` は本物の 429。スクリプトは両方を検出する。
- **他の測定と同じ分に重ねない**: `raw-stream.sh` / `raw-large.js` も `openAsMember` と `/raw` を呼ぶ。同じ利用者・同じ IP のカウンタを共有するので、`view-raw.js` と同時に走らせない。
- **閲覧ログ**: `openAsMember` は呼ぶたびに `access_logs` に 1 行入る（保持 180 日）。測定後にテスト用フォルダごと削除するか、`npm run seed:cleanup` を使う。
- **Supavisor**: 関数 1 インスタンスの接続は最大 3（`src/server/db/client.ts`）。同時 20 でインスタンスが増えると Free の接続上限に当たりうる。エラー率の上昇（500 / `INTERNAL`）が出たらその段階で止め、Supabase のログで接続数を確認する。
- **負荷を上げる前に egress を確認**: Supabase ダッシュボードの Usage で前後の値を記録する（runbook §10 の月間 egress 確認手順）。

## egress の見積もり（Supabase Free 5GB / 月に対する消費）

| 測定 | 条件 | 概算 |
|---|---|---|
| ttfb.sh | 5 ページ × 11 回、HTML のみ | 数 MB 以下（Storage を通らない。DB 応答のみ） |
| k6/pages.js | 保持 1 分、HTML のみ | 数十 MB 以下 |
| k6/view-raw.js（`ladder`） | 100KB ファイル、各段階 2 分（12 秒間隔。25 + 50 + 100 回 / 分）、約 400 対 | 約 40MB |
| k6/view-raw.js（`nf11`） | 1MB ファイル、5 VU で合計 30 回 | 約 30MB |
| k6/view-raw.js（`limit-check`） | `openAsMember` 31 回のみ（`/raw` なし） | 数 KB |
| curl/raw-stream.sh | 50MB × 最大 3 回 | 約 150MB |
| k6/raw-large.js | 50MB × 3 回 | 約 150MB |
| 合計（全部実施） | | 約 0.4GB（月間枠の 8%）。WP-5.4 の 50MB 確認（最大 3 回 = 150MB）と合算しても 0.55GB 程度 |

1MB ファイルで同じラダーを回すと約 0.4GB を使うので、ラダーには 100KB を使い、1MB は NF-11 の判定用（`nf11`）に絞る。

## view-raw.js の設計（T-057。`ticket:user` 30 回 / 分と `raw:ip` 120 回 / 分の両立）

方針: 利用者を分ける（`PERF_COOKIE_1..N`）+ 1 反復を 12 秒に固定（`PERF_PACE_SEC`）。1 名の Cookie だけだと、20 同時では 100 回 / 分が 1 利用者に集中して `ticket:user` を超えるため。k6 は 1 台から打つので IP は 1 つで、全 VU の対が `raw:ip` に合算される。**1 反復 = `openAsMember` 1 回 + `/raw` 1 回**。

必要な利用者数は N = 5 名以上（20 同時で 1 名あたり 4 VU × 5 回 / 分 = 20 回 / 分）。起動時に最悪値を計算し、1 名あたり 24 回 / 分（上限 30 の 80%）または IP あたり 100 回 / 分（上限 120 の約 83%）を超えるなら `fail()` で中止する（余裕は固定ウィンドウの境界と他の測定の混入のため。`PERF_USER_CAP` / `PERF_IP_CAP` / `PERF_ALLOW_OVER=1` で変更。意図的に超える時だけ）。

`ladder`（NF-02。5 → 10 → 20 VU、間隔 12 秒、N = 5 名）:

| 段階 | VU | 全体（= `raw:ip`、上限 120） | 1 名あたり（`ticket:user`、上限 30） | 判定 |
|---|---|---|---|---|
| 1 | 5 | 25 回 / 分 | 5 回 / 分（1 VU / 名） | 範囲内 |
| 2 | 10 | 50 回 / 分 | 10 回 / 分（2 VU / 名） | 範囲内 |
| 3 | 20 | 100 回 / 分 | 20 回 / 分（4 VU / 名） | 範囲内（IP は 20、名あたりは 10 の余裕） |

N = 10 名なら 20 VU でも 1 名あたり 10 回 / 分。N が 5 未満だと 20 VU の段階の検査で中止になる（N = 4 は 25 回 / 分で上限 30 内だが、余裕 24 を超える）。レイテンシが 12 秒を超えると実際の回数はこれより減る（上限から遠ざかる側）。VU は同時に動く利用者数を表し、各利用者は 12 秒に 1 回開く（閉じたモデル）。

`nf11`（NF-11。1MB ファイル、5 VU、合計 30 回）: N = 5 名で 1 名 5 回 / 分、全体 25 回 / 分、所要約 72 秒。旧記載の `--vus 5 --iterations 30` は、`scenarios` を持つスクリプトでは CLI の `--vus` / `--iterations` が反映されない（または競合する）ため廃止し、`PERF_MODE=nf11` に置き換えた。1 名だけで測る場合は `PERF_PACE_SEC=15`（5 VU × 4 回 / 分 = 20 回 / 分）にする。

`limit-check`（任意。`ticket:user` の 30 回目 ok / 31 回目 `RATE_LIMITED` の 1 回確認）: 1 名（最後の Cookie）で `openAsMember` を 31 回連続で呼ぶ。直前 60 秒にその利用者が `openAsMember` を呼んでいないこと。他の測定と同時に走らせない。副作用: `access_logs` に 30 行、未使用チケット 30 枚（期限で失効）、監査ログに `security.rate_limited` 1 行。

```bash
# ladder（PERF_FILE_ID は 100KB のファイル）
PERF_COOKIE_1=*** PERF_COOKIE_2=*** ... PERF_COOKIE_5=*** k6 run --out json=tests/perf/results/view-raw-$(date +%Y%m%d-%H%M).json tests/perf/k6/view-raw.js
# NF-11（PERF_FILE_ID は 1MB のファイル）
PERF_MODE=nf11 （同じ環境変数） k6 run tests/perf/k6/view-raw.js
# ticket:user の境界確認
PERF_MODE=limit-check （同じ環境変数） k6 run tests/perf/k6/view-raw.js
```

前提（人間作業）: メンバーのログイン Cookie が N = 5 名分要る。`.env.local` に `SEED_EXTRA_MEMBERS=4` を設定して `npm run seed` を実行すると、`seed-member@example.com` と `seed-member-2` 〜 `seed-member-5@example.com` の 5 名が `seed-folder` のメンバーとして作られる（パスワードは `SEED_PASSWORD`。runbook §10、T-059）。5 名それぞれでログインして Cookie を取得し `PERF_COOKIE_1..5` に設定するのは人間（ログに出さない）。`PERF_FILE_ID` のファイルは `seed-folder` に置くか、5 名を測定用フォルダのメンバーに追加する（seed は files を作らない）。測定後は `npm run seed:cleanup`（`seed-member-2..20` も対象）。

## 結果の記録先

- 生データ（k6 の JSON、CSV）: `tests/perf/results/`（コミットしない。報告には貼らず、パスと日時だけ書く）
- 要約: `docs/agents/reports/T-xxx-performance-tester.md` と `docs/agents/coverage.md` の「性能」表
- 目標未達は `docs/agents/findings/F-xxx.md`
