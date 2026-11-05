# 構成

ブラウザの中で動く静的なページ（Vite、TypeScript、D3）と、AI の質問だけが使う小さな中継（Cloudflare Worker）でできている。人口の計算はすべてブラウザの中の計算エンジンが行い、AI もその同じエンジンを道具として呼ぶ。この版では中継を公開していないので、AI の質問は動かない（README の「限界と未完了」）。

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

## モジュール

| 場所 | 役割 |
|---|---|
| `pipeline` | 出典のファイルを取得し（SHA256 で照合）、`public/data` を作る Python（標準ライブラリだけ）。`check_codes.py` が社人研の地域と境界のコードを突き合わせる |
| `src/engine` | `step`（1期の計算）、`project`（地域ごと・全地域）、`scenarios`（出生率・移動の前提）、`infra`（インフラ連動の仮定）、`facilities`（施設の判定）、`allocation`（人口の割り振り）、`aggregate`（合計）。DOM もネットワークも使わない純粋な関数 |
| `src/data` | `loader`（データの読み込み、失敗の分類）、`runner`（検証したシナリオだけを全地域に適用して覚える） |
| `src/map` | 日本・県の地図、色（2020年比の対数。割り振りを表示する時は人口の変化）、凡例、キーボードの操作（`keyboard.ts`。地図ごとに Tab の停止位置は1つで、矢印・PageUp/PageDown・Home/End で移る） |
| `src/ui` | 骨組み `app.ts`（地図へのスキップリンク、Esc で割り振りを消す）、共有の状態 `state.ts`（選択、年、前提、割り振りの地図表示 `allocation`）、パネル 4つ（町の詳細、前提、割り振り、AI）。割り振りを地図に出す部分は `allocationOverlay.ts`・`allocationView.ts`・`allocationCore.ts`。見た目の決まりは `DESIGN.md` と `theme.css` |
| `src/ai` | `toolDefs`（道具の定義。データだけ）、`tools`（道具の実装）、`numberCheck`（答えの数字の検査）、`client`（Worker とのやり取りと道具のループ）、`cached`（保存済みの答え） |
| `worker` | `index`（`POST /api/chat`。上流への要求の本体とヘッダーは定数と検査済みの `messages` と道具の定義だけから作る）、`validate`（本文の検査と作り直し）、`rateLimit`（IP ごとの1日の回数と、16個のキーに分けた全体の1日の回数。短時間の連続の制限 `IP_LIMITER` は `index` が呼ぶ。書き込みの失敗は通し、読み出しの失敗は止める）、`systemPrompt`。すべての応答に `nosniff`、想定外の失敗は同じ形の 500、ログは固定の文字列だけ |

## 守っている4つの約束

1. **型**：`Area`・`Scenario`・`Series`（`src/engine/types.ts`）。`Area` は2020年の人口、2025〜2050年の公式の合計、6期間の前提（前提が公表されていない13村は `null` と、公式の年齢別人口）を持つ。`Scenario` は4つの値（子ども女性比の倍率、移動の続け方、移動の強さ、インフラ連動の強さ）。`Series` は2020〜2100年の5年刻み。施設は番号（`id`）で引き、名前では引かない。
2. **状態とパネル**：パネルは `(el, ctx)` を受け取る。`ctx` は `PanelContext = { store, data, runner }`。`store.set` は、シナリオを検査して `series` を同じ通知の中で作り直し、選択した町と県の食い違いを直し、範囲外の値は黙って受け入れず断る。パネルは `store.subscribe` で描き直し、取り付けの解除関数を返す。
3. **計算は常に全地域のリストで**：前提が公表されていない村の2050年以降は、同じ県の変化率で延ばす。その県の合計は、渡した地域から作るので、一部の地域だけを渡すと村が静かに間違う。`runner` と AI の道具は、必ず1,884地域の全部を渡す。さらに、画面の入力や AI の入力は、範囲（子ども女性比 0.6〜1.4、移動の強さ 0〜1.5、インフラ連動 0〜0.01）を検査して、範囲外は丸めずに断る。
4. **道具の定義は中継（サーバー）が持つ**：道具の名前・説明・入力の形は、データだけの1つのファイル `src/ai/toolDefs.ts` が正本で、道具の実装（`tools.ts`）と Worker の両方がこれを読む。Worker は毎回この定義を Claude に送り、画面から来た道具の定義や `system` は使わない。画面が送るのは `messages` だけ。モデル、`max_tokens`、システムプロンプトも Worker が決める。

## テストの方針

- **公式の結果との照合（ゴールデンテスト）**：前提が公表されている1,871地域で2050年までを計算し、公式の合計と比べる（ずれの中央値、0.5%以内に収まる割合、最大のずれにしきい値）。全国の合計と田辺市の値も固定する。
- **変異テスト**：テストが本当に失敗しうるかを、コードをわざと壊して確かめた（例：割り振りで対象を元から外さない、期間の境目を1つずらす、数字の許容幅を広げる）。壊しても通ってしまうテストは、レビューで差し戻した。
- **画面と Worker のあいだの契約テスト**：画面が作るすべての要求を、Worker の本物の検査関数 `worker/validate.ts` に通して受理されることを確かめる。Worker が送る道具の定義は画面側の実装と同じファイルから来るので食い違わない。そのうえで、定義にあるすべての道具に実装と画面での呼び名があることをテストで確かめる。
- **独立の数字**：テストの期待値は、テスト対象とは別の経路で出した数字（Python の試作、基準実装 `test/helpers/referenceProjection.ts`、台帳に残した値。試作と台帳は、このリポジトリには入っていない）に置く。
- 実機の確認：390px 幅と広い画面（1512px）のブラウザで、横スクロールが出ないことと、数字が画面と計算で一致することを、最後の全体レビューと修正の波の各流れで確かめた（どの版で確かめたかは README の「限界と未完了」）。

テストは `npm test`（Vitest）と `npm run test:py`（データ作り）。件数は README にある。
