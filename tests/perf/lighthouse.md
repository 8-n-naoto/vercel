# Lighthouse (Web Vitals) 手順

未実行。Lighthouse とヘッドレス Chrome が未導入のため、導入後に実施する（導入は判断依頼）。

## 前提

- 認証が要る画面は Cookie が要る。Lighthouse の `--extra-headers` に Cookie を渡す（値は環境変数から。ファイルに書かない）。
- 測定対象: `/login`（認証不要）、`/folders`、`/folders/<id>`、`/folders/<id>/files/<id>`、`/view/<id>`。
- `/view` は iframe 内の `/raw` を含むため、LCP は外側のシェルで測る。iframe 内の HTML の描画は対象外（アップロード内容に依存する）。

## コマンド例

```bash
# headers.json は mktemp で作る 0600 のファイル。内容は {"Cookie":"<PERF_COOKIE の値>"} 。測定後に削除する。
npx lighthouse "$PERF_APP_ORIGIN/folders" \
  --extra-headers=./headers.json \
  --only-categories=performance \
  --preset=desktop --throttling-method=simulate \
  --chrome-flags="--headless=new" \
  --output=json --output-path=tests/perf/results/lh-folders-<date>.json
```

- モバイル（既定プリセット）とデスクトップの両方を各 3 回測り、中央値を記録する。
- 見る値: LCP、CLS、TBT（INP の代替。INP はフィールド計測が要るため Lighthouse では出ない）、転送サイズ（`total-byte-weight`）、未使用 JS（`unused-javascript`）。
- 目標: NF-09 は TTFB（`server-response-time`）で判定する。LCP / INP / CLS の数値目標は設計に無い（判断依頼で暫定値を提案: LCP 2.5 秒、CLS 0.1、TBT 200ms）。
