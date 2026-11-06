# 構成

ブラウザの中で動く静的なページ（Vite、TypeScript、D3）と、AI の質問だけが使う小さな中継（Cloudflare Worker）でできている。人口の計算はすべてブラウザの中の計算エンジンが行い、AI もその同じエンジンを道具として呼ぶ。画面と中継は 2026-11-06 に公開した（下の「公開されているもの」）。AI の質問は公開ページで動く（確かめたことと、確かめていないことは README の「限界と未完了」）。

## データの流れ

```
社人研の Excel 4本        国土数値情報 N03 の zip 47本      国土交通省の施設の表（PDF 3ページ目）
  │ pipeline/fetch_sources     │ pipeline/build_geometry          │ pipeline/build_facilities
  │ pipeline/build_areas       │ （mapshaper で簡略化）           │ （図から転記した値を JSON に）
  ▼                            ▼                                  ▼
public/data/areas/<県>.json   public/data/geo/*.topo.json       public/data/facilities.json（48施設）
public/data/groups.json（政令市・県の対応）、index.json
  │
  ▼  src/data/loader.ts（ブラウザが読み込む）
AppData { areas（1,884）, groups, facilities, japanTopo }
  │
  ▼  src/data/runner.ts   シナリオ → 全1,884地域を 2100 年まで計算（結果はシナリオごとに覚える）
src/engine（コーホート要因法） ──▶ Map<地域コード, Series>
  │                                      │
  ▼                                      ▼
src/ui/state.ts の store ──▶ src/map（地図）と src/ui のパネル（町の詳細・前提・割り振り・AI）
                                         ▲
src/ai/tools.ts（8つの道具。同じ engine を呼ぶ）◀── src/ai/client.ts ──▶ worker/（messages だけを受け取る）──▶ Anthropic API
```

## 公開されているもの

| 部品 | 内容 |
|---|---|
| 画面 | Cloudflare Pages のプロジェクト `japan2100`（https://japan2100.pages.dev）。`npm run build` で作った `dist/` を、直接アップロードで置いてある。ビルドのときに `VITE_CHAT_ENDPOINT` で中継の URL を埋め込む（`docs/ai-endpoint.md`）。`public/_headers` で、検索エンジンに載せない設定（`X-Robots-Tag: noindex, nofollow`）と、`nosniff`・`Referrer-Policy` を付けている |
| 中継 | Cloudflare Worker `town-2100-api`（https://town-2100-api.your-account.workers.dev ）。呼び出してよい出どころは、`ALLOWED_ORIGINS` で公開ページだけ |
| 中継の設定 | KV `RATE_KV`（名前空間 `town-2100-rate`）、Rate Limiting `IP_LIMITER`（60 秒に 20 回）、秘密 `ANTHROPIC_API_KEY`・`IP_HASH_SECRET`、変数 `ALLOWED_ORIGINS`。値は `worker/wrangler.jsonc`（秘密は含まない）。1日の上限の標準は、1人60回、全体400回 |
| Anthropic 側 | この中継専用のワークスペース。月の利用上限 100 ドル、25 ドルでのメール通知、毎分の上限。API キーは Worker の秘密にだけ置き（作成のとき、作成画面を操作したブラウザの一時ファイルに値が写り、削除した。[dev-log.md](dev-log.md) の 6.2）、期限は 2026-12-06 |
| 保存済みの答え | `public/data/cached_answers.json`。5件、すべて作者が全文を読んで承認した確認済み（`verified`、2026-11-06）。画面は、質問の例のボタンを押したときに中継を呼ばずに出し、AI に接続できないときにも、同じ質問の答えがあれば出す。`pending` の答えは出さない。既知の限界が2つ（田辺市の答えの「公式 42,311 人」、和歌山県の答えは減る地域を答えられない）あり、ファイルの note に書いてある |
| リポジトリ | GitHub の `main`。公開の状況は、README の冒頭の「リポジトリ」の行のとおり |

## モジュール

| 場所 | 役割 |
|---|---|
| `pipeline` | 出典のファイルを取得し（SHA256 で照合）、`public/data` を作る Python（標準ライブラリだけ）。`check_codes.py` が社人研の地域と境界のコードを突き合わせる |
| `src/engine` | `step`（1期の計算）、`project`（地域ごと・全地域）、`scenarios`（出生率・移動の前提）、`infra`（インフラ連動の仮定）、`facilities`（施設の判定）、`allocation`（人口の割り振り）、`aggregate`（合計）。DOM もネットワークも使わない純粋な関数 |
| `src/data` | `loader`（データの読み込み、失敗の分類）、`runner`（検証したシナリオだけを全地域に適用して覚える） |
| `src/map` | 日本・県の地図、色（2020年比の対数。割り振りを表示する時は人口の変化）、凡例、キーボードの操作（`keyboard.ts`。地図ごとに Tab の停止位置は1つで、矢印・PageUp/PageDown・Home/End で移る） |
| `src/ui` | 骨組み `app.ts`（地図へのスキップリンク、Esc で割り振りを消す）、共有の状態 `state.ts`（選択、年、前提、割り振りの地図表示 `allocation`）、パネル 4つ（町の詳細、前提、割り振り、AI）。割り振りを地図に出す部分は `allocationOverlay.ts`・`allocationView.ts`・`allocationCore.ts`。見た目の決まりは `DESIGN.md` と `theme.css` |
| `src/ai` | `toolDefs`（道具の定義。データだけ）、`tools`（道具の実装）、`numberCheck`（答えの数字の検査）、`client`（Worker とのやり取りと道具のループ）、`cached`（保存済みの答え） |
| `worker` | `index`（`POST /api/chat`。上流への要求の本体とヘッダーは定数と検査済みの `messages` と道具の定義だけから作る）、`validate`（本文の検査と作り直し）、`rateLimit`（IP ごとの1日の回数と、16個のキーに分けた全体の1日の回数。短時間の連続の制限 `IP_LIMITER` は `index` が呼ぶ。読み出しも書き込みも、失敗したら止める（503。上流は呼ばない））、`systemPrompt`（モデルへの決まり。勧めない、「予測」と書かない、に加えて、画面は文字をそのまま表示するので、表・太字や斜体の記号・見出しの記号を使わせない規則を含む）。すべての応答に `nosniff`、想定外の失敗は同じ形の 500、ログは固定の文字列だけ |

## 守っている4つの約束

1. **型**：`Area`・`Scenario`・`Series`（`src/engine/types.ts`）。`Area` は2020年の人口、2025〜2050年の公式の合計、6期間の前提（前提が公表されていない13村は `null` と、公式の年齢別人口）を持つ。`Scenario` は4つの値（子ども女性比の倍率、移動の続け方、移動の強さ、インフラ連動の強さ）。`Series` は2020〜2100年の5年刻み。施設は番号（`id`）で引き、名前では引かない。
2. **状態とパネル**：パネルは `(el, ctx)` を受け取る。`ctx` は `PanelContext = { store, data, runner }`。`store.set` は、シナリオを検査して `series` を同じ通知の中で作り直し、選択した町と県の食い違いを直し、範囲外の値は黙って受け入れず断る。パネルは `store.subscribe` で描き直し、取り付けの解除関数を返す。
3. **計算は常に全地域のリストで**：前提が公表されていない村の2050年以降は、同じ県の変化率で延ばす。その県の合計は、渡した地域から作るので、一部の地域だけを渡すと村が静かに間違う。`runner` と AI の道具は、必ず1,884地域の全部を渡す。さらに、画面の入力や AI の入力は、範囲（子ども女性比 0.6〜1.4、移動の強さ 0〜1.5、インフラ連動 0〜0.01）を検査して、範囲外は丸めずに断る。
4. **道具の定義は中継（サーバー）が持つ**：道具の名前・説明・入力の形は、データだけの1つのファイル `src/ai/toolDefs.ts` が正本で、道具の実装（`tools.ts`）と Worker の両方がこれを読む。Worker は毎回この定義を Claude に送り、画面から来た道具の定義や `system` は使わない。画面が送るのは `messages` だけ。モデル、`max_tokens`、システムプロンプトも Worker が決める。

## テストの方針

- **公式の結果との照合（ゴールデンテスト）**：前提が公表されている1,871地域で2050年までを計算し、公式の合計と比べる（ずれの中央値、0.5%以内に収まる割合、最大のずれにしきい値）。全国の合計と田辺市の値も固定する。町の2050年までの数字は、公式の方法の再計算で、社人研の表と数人違うことがある（田辺市は、ここでは 42,311 人、社人研の表では 42,309 人）。道具はそれを「公式」の枠で返すので、AI の答えも「社人研の公式推計」と書くことがある。画面の表の下の注記が、同じことを言っている。
- **変異テスト**：テストが本当に失敗しうるかを、コードをわざと壊して確かめた（例：割り振りで対象を元から外さない、期間の境目を1つずらす、数字の許容幅を広げる）。壊しても通ってしまうテストは、レビューで差し戻した。
- **画面と Worker のあいだの契約テスト**：画面が作るすべての要求を、Worker の本物の検査関数 `worker/validate.ts` に通して受理されることを確かめる。Worker が送る道具の定義は画面側の実装と同じファイルから来るので食い違わない。そのうえで、定義にあるすべての道具に実装と画面での呼び名があることをテストで確かめる。
- **独立の数字**：テストの期待値は、テスト対象とは別の経路で出した数字（Python の試作、基準実装 `test/helpers/referenceProjection.ts`、台帳に残した値。試作と台帳は、このリポジトリには入っていない）に置く。
- 実機の確認：公開前は、390px 幅と広い画面（1512px）のブラウザで、横スクロールが出ないことと、数字が画面と計算で一致することを、最後の全体レビューと、修正の波の画面に関わる2つの流れと、最終の統合版（fa21f09）で確かめた（確かめた内容は README の「限界と未完了」）。
- **公開した中継での確認**：`scripts/ai_live_check.ts` が、公開した Worker に画面と同じ `ask()` で質問を送り、道具の定義・長い会話・キャッシュ・トークン数・`stop_reason` を記録する（[ai-live-check.md](ai-live-check.md)）。偽の応答では確かめられない部分（実際の API が要求を受け付けるか）のためで、`npm test` には入っていない。お金がかかる（2026-11-06 の合計で、見積もり約1.80ドル）。

テストは `npm test`（Vitest）と `npm run test:py`（データ作り）。件数は README にある。
