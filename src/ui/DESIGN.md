# 画面の設計（Task 8 で決めた正本。Task 9・10・13 はこれに従う）

このアプリの見た目は 1 回だけ決める（Ruling 23）。トークンは `src/ui/theme.css`、骨組みは `src/ui/app.css`。パネルを作る人は、ここにある部品だけを組み合わせ、新しい色・書体・影・角丸を発明しない。

## 方向

- 題材は「2100年の日本」の人口。市民・自治体職員・審査員が読む、落ち着いた公的データの刊行物の調子。
- 紙色の地、墨の文字、藍のアクセント 1 色。地図の赤錆（減少）と青（増加）はデータの色で、UI の装飾には使わない。
- 見出しと大きな数字は明朝、それ以外はゴシック。等幅は使わない。英語の大文字の小見出し、カード型の影の連なり、グラデーションの帯は使わない。
- 目立たせるのは地図と年のつまみだけ。年を動かすと地図の色が 2020 年比で移ろう、これが記憶に残る瞬間。ほかは静かに。
- 「試算」は破線で示す。年のトラックの 2050 年より後は破線、試算の印 `.badge-estimate` も破線。
- 勧めない。文言は事実の提示だけ（「残せない」でなく「人口の目安を下回る」）。

## トークン（`theme.css` の `:root`）

| 役割 | 変数 | 値 |
|---|---|---|
| 地（紙）・海 | `--paper` | `#f6f5f0` |
| 薄い面（骨組み・控えめな塗り） | `--paper-2` / `--paper-3` | `#edebe4` / `#e3e0d7` |
| 文字 | `--ink` | `#1b2430`（紙に対して 14.3:1） |
| 補助の文字 | `--ink-2` | `#4a5563`（6.9:1） |
| 注記の文字 | `--muted` | `#5b6470`（5.5:1。13px 以下はこれ以上薄くしない） |
| 線 | `--line` / `--line-2` | `#d9d6cc` / `#b9b5a9` |
| アクセント（リンク・主ボタン・フォーカス） | `--accent` | `#2b4c7e`（7.9:1） |
| 減少（地図の赤錆。施設が目安を下回る印にも使う） | `--decline` / `--decline-deep` / `--decline-soft` | `#a43d2b` / `#721d14` / `#f2ddd6` |
| 増加（地図の青） | `--growth` / `--growth-soft` | `#376daf` / `#dde6f2` |
| 地図の中立（2020 年と同じ） | `--map-neutral` | `#d0c9c4` |
| 折れ線：公式 / 試算 / 参考 | `--series-official` / `--series-estimate` / `--series-reference` | 墨の実線 / 藍の破線 / `#8a8378` の点線 |
| 人口ピラミッド：男 / 女 | `--pyramid-m` / `--pyramid-f` | `#2b4c7e` / `#9bb3d6`（明度差で区別。凡例と直接のラベルを必ず付ける） |
| 書体 | `--font-display` / `--font-body` | 明朝（Hiragino Mincho ProN, Yu Mincho）/ ゴシック（Hiragino Sans, Yu Gothic） |
| 文字の大きさ | `--fs-12` … `--fs-56` | 12 は注記だけ。本文 16、パネル見出し 20、大きな数字 28、年 44 |
| 余白 | `--sp-1` … `--sp-8` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| 角丸・影・フォーカス | `--radius` 4px、`--shadow` 1 段、`--focus-ring` 2px の藍 | 影はツールチップと検索候補だけ |
| 触れる大きさ | `--touch` | 44px |

地図の色の計算は `src/map/colors.ts` の `changeColor(ratioTo2020)`。対数（半減ごとに同じ距離）、1 … 1/16 が赤錆、1 … 1.5 が青、範囲外は端に丸める。

## 配置（slots）

- 390px：1 列。上から 見出し → 場所の行（パンくず・戻る・検索）→ 場所の数字 → 地図 → 凡例 → 年 → `#panel-town` → `#panel-controls` → `#panel-allocation` → `#panel-ai` → 出典。
- 1024px 以上：2 列（地図 3 : パネル 2）。左の地図の列は `position: sticky` で、地図・凡例・年が 1 画面に収まる。右の列にパネルが縦に並ぶ。
- パネルは `(el: HTMLElement, ctx: PanelContext)` で `el`（既にある `<section class="panel" id="panel-…">`）の中身を置き換える。`el` 自体の class と id は変えない。見出しは `h2.panel-title` を 1 つ残す。
- 取り付けは `src/ui/app.ts` の `mountPanels(ctx, slots)`（「Panel registry」の印の付いた 4 行）。Task 9 は `slots.town` の行、Task 10 は `slots.controls` と `slots.allocation` の行、Task 13 は `slots.ai` の行を、それぞれ自分の `mountXxxPanel(slots.xxx, ctx)` に置き換える。app.ts のほかの所は触らない。
- 横スクロールを出さない。横長の表は `.table-wrap` に入れる。

## 部品（class 名）

| 用途 | 書き方 |
|---|---|
| パネルの見出し | `<h2 class="panel-title">町の詳細 <span class="badge-estimate">試算</span></h2>`（試算の印は 2050 年より後の数字を含む時だけ） |
| パネルの説明 1 行 | `<p class="panel-lead">…</p>` |
| 何も選ばれていない時 | `<p class="panel-empty">町を選ぶと、ここに詳しい数字が出ます。</p>` |
| パネル内の小さな節 | `<div class="panel-section"><h3 class="panel-section-title">…</h3>…</div>` |
| 主要な数字 | `<div class="kpi-row"><div class="kpi"><div class="kpi-label">2100年の人口</div><div class="kpi-value">1.2<span class="kpi-unit">万人</span></div><div class="kpi-note">2020年比 −83.0%</div></div>…</div>` |
| 表 | `<div class="table-wrap"><table class="data-table"><thead><tr><th>施設</th><th class="num">目安</th></tr></thead><tbody><tr><td>…</td><td class="num">5,000人</td></tr></tbody></table></div>`。数字は `.num`（右揃え・等幅数字） |
| 施設の状態 | `<span class="tag tag-ok">成り立ちやすい</span>` / `<span class="tag tag-edge">境目</span>` / `<span class="tag tag-below">人口の目安を下回る</span>` |
| 試算・公式の印 | `<span class="badge-estimate">試算</span>` / `<span class="badge-official">公式推計</span>` |
| 注記 | `<p class="note">…</p>`、`<div class="notice">…</div>`、仮定の注意は `<div class="notice notice-estimate">…</div>` |
| ボタン | `<button class="btn">…</button>`、主ボタン `.btn.btn-primary`（1 画面に 1 つ）、静かな導線 `.btn.btn-quiet`、正方形 `.btn.btn-icon`。文言は動詞（「計算し直す」「元に戻す」） |
| 並んだボタン | `<div class="actions">…</div>` |
| スライダー | `<div class="field"><label class="field-label" for="x">出生率の倍率 <span class="field-value">1.00</span></label><input id="x" type="range" class="range" min="0.6" max="1.4" step="0.05"><p class="field-help">2050年より後の期に掛ける</p></div>` |
| 2 択 | `<div class="choice" role="group" aria-label="人口移動"><button aria-pressed="true">据え置き</button><button aria-pressed="false">2100年に向けて止まる</button></div>` |
| 文字入力 | `<input class="input" type="text">`、`<textarea class="input">` |
| 読み込み中 | `<div class="skeleton" style="height:120px"></div>` |
| 画面の外に出す文字（読み上げ用） | `.sr-only` |

## 数字と文言

- 人口は `formatPop()`（`src/ui/format.ts`）：8,340人 / 4.2万人 / 1,190万人 / 1億2,615万人。増減は `formatPct()`：−31.5% / +2.5%（マイナスは U+2212）。
- 2050 年より後の数字には必ず試算の印を付け、「予測」と書かない。文言の正本は `src/ui/sources.ts`（`ESTIMATE_NOTE`・`OFFICIAL_NOTE`・出典）。
- 「残せない」でなく「人口の目安を下回る」。残す・残さないを勧める言葉は書かない。
- 丸数字・矢印記号・英語の大文字ラベルは使わない。

## チャート（Task 9 の推移・ピラミッド）

- インライン SVG。軸と目盛線は `--grid`、文字は `--ink-2`（系列の色で文字を塗らない）。線は 2px、点は 8px 以上。
- 推移は 1 軸。公式（墨・実線）、試算（藍・破線）、参考（灰・点線）の 3 本まで。凡例は必ず置き、2050 年の縦線で公式と試算の境を示す。
- ピラミッドは男 `--pyramid-m`、女 `--pyramid-f` を左右に。年齢の階級は 5 歳ごと 20 区分。
- 地図の色と同じ意味で赤錆を使うのは「目安を下回る」の時だけ。

## 状態と更新

- 状態は `store`（`src/ui/state.ts` の `createAppStore`）。`store.get()` で `year`・`scenario`・`series`・`selectedPref`・`selectedArea` を読み、`store.subscribe((s, prev) => …)` で描き直す。`store.set(patch)` は適用されたら `true`、何も変わらない・拒否されたら `false` を返す。
- 町を選ぶ時は `store.set({ selectedArea: code })` だけでよい。store が `selectedPref` をその町の県にそろえる（県の地図・パンくず・戻るボタンも付いてくる）。`store.set({ selectedPref })` で県を変えると、その県に属さない町の選択は消える。`selectedPref: undefined` で日本に戻る（町の選択も消える）。無い地域コード・県コードは拒否される（状態は変わらず、通知も無く、console.warn が出る）。`src/ui/nav.ts` の `pickArea`・`pickPref`・`goUp`・`toJapan` は同じ patch を作る便利関数。
- `store.set({ scenario })` を呼ぶと、`series` が同じ通知の中で更新されて届く（自分で runner を呼ばない）。範囲外・NaN・未知の migMode は拒否され、前の値が残る（通知なし・console.warn）。値が同じ scenario を入れ直しても通知は無い。スライダーの min/max は `SCENARIO_LIMITS`（`src/data/runner.ts`）に合わせる。
- `year` は 2020〜2100 の 5 年刻みだけ受け付ける（それ以外は拒否）。
- 年ごとの合計は `deriveTotals(series, data.groups)`（`src/ui/derive.ts`）。`series` が同じ間は同じ結果が返るので、呼ぶたびに計算し直さない。
- 描き直しは変わった所だけ。DOM を作り直さず、文字と属性を更新する。

## 確認（納める前）

- `npm run typecheck && npx vitest run && npm run build`。
- Playwright で 390px を先に、次に新しいタブで PC 幅（追従）。横スクロールが無いこと、文字が 4.5:1 以上、触れる所が 40px 以上。
- 試算の印が 2050 年より後に出ること、「予測」の語が無いこと。
