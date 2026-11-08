# 画面の設計（Task 8 で決めた正本。パネル（Task 9・10・13）はこれに従い、足した部品もここに載せる）

このアプリの見た目は 1 回だけ決める（Ruling 23）。トークンは `src/ui/theme.css`、骨組みは `src/ui/app.css`、パネルの配置の糊は各パネルの css（`townPanel.css`・`controlsPanel.css`・`aiPanel.css`）。ここにある部品だけを組み合わせ、新しい色・書体・影・角丸を発明しない。

## 方向

- 題材は「2100年の日本」の人口。市民・自治体職員・審査員が読む、落ち着いた公的データの刊行物の調子。
- 紙色の地、墨の文字、藍のアクセント 1 色。地図の色はデータの色で、UI の装飾には使わない：2020 年比は藍 1 色の濃淡（残る人が少ないほど薄い）、高齢者1人を支える人数は灰から黒（支える人が少ないほど黒に近い）、割り振りの変化だけ赤錆（減少）と青（増加）。
- 見出しと大きな数字は明朝、それ以外はゴシック。等幅は使わない。英語の大文字の小見出し、カード型の影の連なり、グラデーションの帯は使わない（右の列のパネルは枠と藍の帯で区切る 4 枚のカードで、影は付けない）。
- 目立たせるのは地図と年のつまみだけ。年を動かすと地図の色が 2020 年比で薄れていく、これが記憶に残る瞬間。ほかは静かに。
- 「試算」は破線で示す。年のトラックの 2050 年より後は破線、試算の印 `.badge-estimate` も破線。「割り振り後」は藍の薄い面 `.badge-alloc`。2050 年より後は試算の印の隣に足し、置き換えない（割り振り中も「試算」が出る）。2050 年まではこの印が公式推計・実績の印に代わる（割り振り後の数字は公式の値ではないため）。

## トークン（`theme.css` の `:root`）

| 役割 | 変数 | 値 |
|---|---|---|
| 地（紙）・海 | `--paper` | `#f6f5f0` |
| 薄い面（骨組み・控えめな塗り） | `--paper-2` / `--paper-3` | `#edebe4` / `#e3e0d7` |
| 文字 | `--ink` | `#1b2430`（紙に対して 14.3:1） |
| 補助の文字 | `--ink-2` | `#4a5563`（6.9:1） |
| 注記の文字 | `--muted` | `#5b6470`（5.5:1。13px 以下はこれ以上薄くしない） |
| 線 | `--line` / `--line-2` | `#d9d6cc` / `#b9b5a9` |
| アクセント（リンク・主ボタン・フォーカス） | `--accent` / `--accent-soft` | `#2b4c7e`（7.9:1）/ `#e4eaf3` |
| 地図の中立（値が無い所・割り振りで変化 0） | `--map-neutral` | `#d0c9c4` |
| 地図の「2020 年比」の 9 段（薄い → 濃い） | `--change-1` … `--change-9` | `#ffffff` `#dee4ed` `#bec9da` `#9fafc8` `#8196b5` `#637da3` `#476490` `#2b4c7e` `#012a64`。`--accent` を**白**に OKLab で 0・14.3・28.6・42.9・57.1・71.4・85.7・100・120 % 混ぜた色（新しい色相は足さない。120 % は同じ色相を一段濃くした外挿で、122 % からは sRGB の外に出る）。隣り合う段は OKLab の明度で 0.083 ずつ（WCAG のコントラスト 1.28〜1.43、「増えた所」だけ 1.61）。いちばん薄い段は白そのもの（無色。紙に対して 1.09:1 なので、地図の線が形を作る）、「同じ」の段が `--accent` そのもの、「増えた所」がいちばん濃い。濃淡の幅は明度 1.0〜0.30（最初の版は 0.90〜0.33。作者の指示「濃淡の幅が狭い・薄いところは無色まででよい」、2026-11-06 夜）。正本は `src/map/colors.ts` の `CHANGE_COLORS` |
| 地図の「高齢者1人を支える人数」の 6 段（少ない → 多い） | `--support-1` … `--support-6` | `#14181f` `#3b3f45` `#676a70` `#97999d` `#cacbcd` `#ffffff`。`#14181f`（黒に近い色の上限）を**白**に OKLab で 100・80・60・40・20・0 % 混ぜた色。隣り合う段は OKLab の明度で 0.158 ずつ（WCAG のコントラスト 1.62〜1.95）、いちばん薄い段は白そのもの（無色。紙に対して 1.09:1 なので、地図の線が形を作る）、支える人が少ないほど黒に近い。正本は `src/map/colors.ts` の `SUPPORT_COLORS` |
| 地図の線（2020 年比の間） | `--map-line-pale` | `rgba(27, 36, 48, 0.32)`。薄い段がほぼ紙なので、紙色の県境と `--line-2` の海岸線は消える。墨の半透明の線はどの段より暗い（面に対して 1.1〜1.9:1）。`app.css` が凡例の `data-mode="ratio"` の間だけ `.mesh` と `.coast` に当てる。ほかの色（支える人数・割り振り）は紙色の県境のまま |
| 折れ線：公式 / 試算 / 参考 | `--series-official` / `--series-estimate` / `--series-reference` | 墨の実線 / 藍の破線 / `#8a8378` の点線 |
| 人口ピラミッド：男 / 女 | `--pyramid-m` / `--pyramid-f` | `#2b4c7e`（紙に 7.9:1）/ `#6085b9`（紙に 3.5:1、paper-2 に 3.2:1。男女は左右と「男」「女」の文字でも区別） |
| チャートの目盛線 | `--grid` | `--line` と同じ |
| 書体 | `--font-display` / `--font-body` | 明朝（Hiragino Mincho ProN, Yu Mincho）/ ゴシック（Hiragino Sans, Yu Gothic） |
| 文字の大きさ | `--fs-12` … `--fs-56` | 12 は注記だけ。本文 16、パネル見出し 20、大きな数字 28、年 44 |
| 余白 | `--sp-1` … `--sp-8` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| 角丸・影・フォーカス | `--radius` 4px、`--shadow` 1 段、`--focus-ring` 2px の藍 | 影はツールチップと検索候補だけ |
| 触れる大きさ | `--touch` | 44px |

地図の色の計算は `src/map/colors.ts`。2020 年比は `changeColor(ratio)`：区切り 1/16・1/8・1/4・0.4・1/2・0.7・0.85・1 の 9 段（`CHANGE_BREAKS`。1/16 から 1/4 までと 1/2 が 2100 年の町（中央値 0.25）を、0.4 が 2100 年の県（47 のうち 35 が 1/4〜1/2 に入っていたのを 4・20・15・7・1 に分ける）を、1/2〜1 の中の 2 つの区切りが 2050 年の県（0.58〜1.03）を分ける。根拠の数字は `colors.ts` の注記）。残る人が少ないほど薄く、2020 年と同じ（0.85〜1）が藍そのもの、1 より多い（増えた所）がいちばん濃い。値が無い所は `--map-neutral`。割り振りの変化は `allocationColor(percent, scale)`（0 を中心に ±scale %、赤錆と青の 2 本の腕。scale は `allocationScale()` が最大の変化から 5・10・20・30・50・100 に丸める）。高齢者1人を支える人数（15〜64 歳 ÷ 65 歳以上）は `supportColor(ratio)`：区切り 0.8・1・1.5・2・3 の 6 段（`SUPPORT_BREAKS`。全 1,884 地域の 2020 年と 2100 年の分布から決めた。根拠の数字は `colors.ts` の注記）、支える人が少ないほど黒に近く（上限 `#14181f`）、多いほど薄く、いちばん多い段は白（無色）。段は画面に出す小数 1 桁の値で決める（「1.0人」と出る町は「1〜1.5」の段）。65 歳以上がいない地域（実データには無い）は `--map-neutral` の灰色。良い・悪いの色にはしない（赤錆や青は使わない）。

## 配置（サイト版。2026-11-08 夕、第2版のワイヤーフレームどおり。`src/site/`）

入口（`src/main.ts`）は `src/site/site.ts` の `mountSite`。ハッシュのルートで 1 ページ 1 メッセージ、全ページ共通のグローバルメニュー（名所／地図／答え合わせ／AIに聞く／出どころ。600px 未満は「メニュー」ボタン）。数字はすべて `src/site/model.ts`（エンジンの出力と `public/data`）から。見た目は `src/site/site.css`（トークンは `theme.css`、新しい色相は足さない。12px 未満の文字を出さない。押せる所は 44px 以上）。

| ルート | 見出し 1 文 | 絵 1 枚 |
|---|---|---|
| `#/` | 標準の試算の 2100 年 ÷ 2020 年から出し分け（`homeHeading`） | 日本の地図（県の色＝2025年に対する割合、藍 6 段 `SHARE_COLORS`。名所の点 4 形）。開いた時に 1 回だけ 2025→2100（0.4 秒 × 15）。左上の年・区分・人数は HTML（`.ro`） |
| `#/meisho`、`#/meisho/g/<slug>` | 「日本らしいところ ◯件。…」 | 4 つの線画の記号と点の地図、名前の一覧 |
| `#/meisho/<id>` | A「◯◯は、◯県◯市にあります。…100人が、2100年には約◯人」 | A 県の町の地図＋100 人の並び／B 連鎖：8 種の明かり（脇役。人口の目安を下回ると消える）と 2100 年の 3 つの箱（標準・流出が加速する場合の弱・強。`INFRA_STRENGTH`）／C 15〜64歳の 10 人と、支える人の人形（`supportLoad`）／D 人口の規模ごとの 1 人あたりの歳出の横棒（`barRows`、この町の規模に印）と「作者の考え」の枠／E 公表資料の言葉。下に固定の年のつまみ（`.ybar`） |
| `#/chizu[/<県>[/<町>]]` | 「日本から県へ、県から町へ。…」 | 地図＋横の人口・名所。検索はここだけ |
| `#/awase[/<町>]` | (1) 差 0.24%／(2) 町ごとの 6 段階／年齢の偏り／(3) 1 つの町の線 | HTML の横棒、県の町の地図（`DEVIATION_COLORS`）、SVG の線（幅を測って描く。右端にラベルの余白） |
| `#/ai`、`#/about` | | 既存の `aiPanel`、`SITE_SOURCES` |

区分の印：`.chip.jisseki`（塗り）・`.chip`（枠）・`.chip.shisan`（破線）。線：実績＝太い点、公式推計＝細い実線、公式の前提を延ばした試算＝細い破線、実績で直した試算＝太い破線。`prefers-reduced-motion` では動かさず 2100 年で止める。

## 配置（旧・六つの画面を縦に並べた画面。2026-11-08 夕から入口ではない。部品と試験は残す）

ページは `main.screens` に 6 つの `section.screen` を縦に並べ、その後ろに「くわしく見る」を置く。1 つの画面は、**見出しの 1 文（`h2.screen-title`・明朝・大）＋ 見せるもの 1 つ**。補足は 1 文まで（`.screen-lead`）。注記・出典・細かい操作は「くわしく見る」か次の画面。画面の高さは窓の高さ（`min-height: 100svh`）で、内容が多ければ伸びる（切らない）。各画面の見出しは `h2` 1 つだけ、アプリの題「2100年の日本」は `h1` 1 つ（画面 1 の左上に小さく）。文言と見出しの文を作る関数は `src/ui/screens.ts`、画面の css は `src/ui/screens.css`（新しい色・書体・影・角丸は足さない。`screensCss.test.ts` が検査する）。

| 画面 | id | 見出し | 見せるもの |
|---|---|---|---|
| 1 入口 | `screen-entry` | 数字から作る 1 文：「2100年、日本の人口は約6,300万人。2020年の約半分です。」（`entryHeadline`。年のつまみで年・人数・割合が動く。県・町は場所の名前が主語。2050 年より後は `.badge-estimate`、割り振り中は `.badge-alloc` を最後の文節の中に置く＝`withTail`。色の見方が「支える人数」の間は `entrySupportHeadline`）。補足「全部は残せません。何を残すか、いまのうちに選ぶための地図です。」 | 地図（大きく）、凡例、年のつまみ、小さな 1 行「試算。2050年までは…公式推計」、次の画面への案内 `a.screen-next`。県・町では、見出しの上に場所の行（パンくず・戻る）。割り振り中は `.alloc-bar`。ページは 2100 年で開く（`DEFAULT_YEAR`） |
| 3 選ぶ | `screen-choose` | 「どこかに人を残すと、別のどこかが残せなくなります。」 | 分かれ目の最初の行について、左「ここを残すには ＋約◯人」・右「代わりに、ほかの町から −約◯人」の同じ大きさの 2 つの箱、「同じ人数が入れ替わるだけです。日本全体の人口は変わりません。」、結果の 1 行、「地図に反映する」（`chooseScreen.ts`。計算は `computeKeep`、分かれ目の行の「ここを残すには」と同じ）。行が無い場所では日本全体の最初の行を例にし「日本全体の例」と小さく書く |
| 5 AI に聞く | `screen-ai` | 「気になることは、AI に聞いてください。」 | AI のパネル（`#panel-ai`）：質問の例ボタン（縦）と入力欄。答えは入力欄の下。冒頭の説明は 1 文（2050 年の注記 `.ai-lead-after` は目から外し、画面 6 が言う） |

- 画面 1 の下の「くわしく見る」（`section.app-more`）は、画面 6 の後ろに置く 3 枚の閉じたカード：町の詳細（`#panel-town`）・前提を変える（`#panel-controls`）・人口の割り振り（`#panel-allocation`）。町の数字 4 行（`#panel-facts`、`placeFacts.ts`）は 2026-11-08 にページから外した（町の詳細に同じ 4 枚のタイルがある。部品と試験は残してある）。
- 390px：1 列。各画面は 844px に収める（画面 1 の地図は `calc(100svh - 600px)`、場所の行があれば `- 645px`。年の注記 `.year-note` は読み上げ専用に、町のカードの凡例と要約も読み上げ専用）。1024px 以上：画面は `max-width: 1100px` で中央、見出しは 44px（600px 以上は 32px、未満は 26px）、凡例と年は地図の下で左右に並ぶ。割り振りを地図に出している間の画面 1 は、デスクトップでは収まるが、スマホでは割り振りの行と見出しの添え書きの分だけ窓より少し高い。
- パネルは `(el: HTMLElement, ctx: PanelContext)` で `el` の中身を置き換え、片付けの関数を返す。分かれ目・AI は画面の中の `div`（`h2` を持たない）、閉じたカード 3 枚は `section.panel` で `h2.panel-title` を 1 つ残す（試算の印は `h2` の中に足す）。
- 取り付けは `src/ui/app.ts` の `mountPanels(ctx, slots)`（「Panel registry」の印の付いた 7 行。返った片付けの関数は `destroy()` が呼ぶ）。
- 横スクロールを出さない。横長の表は `.table-wrap` に入れる。

## 共通の部品（`theme.css`）

| 用途 | 書き方 |
|---|---|
| パネルの見出し | `<h2 class="panel-title">町の詳細 <span class="badge-estimate">試算</span></h2>`（試算の印は 2050 年より後の数字を含む時だけ） |
| パネル（カード） | `<section class="panel">`：`--card`（白）の面、1px の `--line-2` の枠、角丸。右の列は 4 枚のカードを `--sp-6` の間隔で並べる（`.panel-column` はグリッド）。見出し `h2.panel-title` は藍（`--accent`）の帯で、カードの上辺いっぱい（試算の印は帯の中で明るい色）。本文は `--panel-inset`（16px、スマホは 12px）だけ内側に置く。影は付けない（枠と帯で区切る） | 以前は罫線 1 本と余白だけで、パネルの終わりと次の始まりが分からなかった（作者の指摘、2026-11-06）。`panelCss.test.ts` が検査する |
| 節の見出し | `<h3 class="panel-section-title">`：`--accent-soft` の帯に、左に藍の 4px の太線、太字 16px、上に `--sp-6` の余白（グループの先頭の 1 つだけ余白なし）。町の名前の `h3.town-name` は節ではなく、大きな名前のまま。表の小さな区分 `h4.facility-group-title` は下に罫 | カードの中でも、どこから別の節か一目で分かるように |
| パネルの説明 1 行 | `<p class="panel-lead">…</p>` |
| 何も選ばれていない時 | `<p class="panel-empty">町を選ぶと、ここに詳しい数字が出ます。</p>` |
| パネル内の小さな節 | `<div class="panel-section"><h3 class="panel-section-title">…</h3>…</div>` |
| 主要な数字 | `<div class="kpi-row"><div class="kpi"><div class="kpi-label">2100年の人口</div><div class="kpi-value">1.2<span class="kpi-unit">万人</span></div><div class="kpi-note">2020年比 −83.0%</div></div>…</div>` |
| 試算・公式・実績・割り振りの印 | `<span class="badge-estimate">試算</span>` / `<span class="badge-official">公式推計</span>`（2020 年は「実績（国勢調査）」、`badgeFor(year)` が選ぶ）/ `<span class="badge-alloc">割り振り後</span>`（数字が割り振りを含む時だけ。2050 年より後は試算の印の後ろに足す。2050 年まではこれが公式・実績の印に代わる。数字が実際に変わる場所だけ） |
| 注記 | `<p class="note">…</p>`、`<div class="notice">…</div>`、仮定の注意は `<div class="notice notice-estimate">…</div>`（破線） |
| ボタン | `<button class="btn">…</button>`、主ボタン `.btn.btn-primary`（1 画面に 1 つ）、静かな導線 `.btn.btn-quiet`、正方形 `.btn.btn-icon`。文言は動詞（「計算し直す」「元に戻す」）。押した状態を持つボタンは `aria-pressed` |
| 並んだボタン | `<div class="actions">…</div>` |
| スライダー | `<div class="field"><label class="field-label" for="x"><span>出生率の倍率</span> <span class="field-value">1.00</span></label><input id="x" type="range" class="range" min="0.6" max="1.4" step="0.05"><p class="field-help">2050年より後の期に掛ける</p></div>` |
| 2 択・3 択 | `<div class="choice" role="group" aria-label="人口移動"><button aria-pressed="true">据え置き</button><button aria-pressed="false">2100年に向けて止まる</button></div>`。縦に積む `.choice.choice-stack`、幅いっぱい `.choice.choice-wide`（`controlsPanel.css`）。枠は overflow で切らないので、端のボタンでもフォーカスの輪が見える |
| 文字入力 | `<input class="input" type="text">`、`<select class="input">`、`<textarea class="input">` |
| 読み込み中 | `<div class="skeleton" style="height:120px"></div>` |
| 画面の外に出す文字（読み上げ用） | `.sr-only` |

## パネルが足した部品の族（各パネルの css。値は全部トークン）

### 分かれ目（`boardPanel.css`、`boardPanel.ts`。文言と計算は `board.ts`、年のまたぎは `src/engine/crossings.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 公表資料に書かれていること（`claims.css`、`claims.ts`。データは `public/data/claims.json`＝50 件・22 都道府県、形の検査と索引は `src/data/claims.ts`） | `.claims`（`div.panel-section`。「ここにある有名なもの」のあと、`.board-already` のまえ。**都道府県を選んだ時だけ**、その県に項目がある時に出し、日本全体・町（県の項目は町に貸さない）・項目の無い県では `hidden`＝「ありません」とは書かない。下に `--sp-5` の余白）`.claims-title`（`h3.panel-section-title`「公表資料に書かれていること」）`.claims-note`（`.note`。見出しの直下に 1 つ：「各資料の原文を引用しています。人口減少との関係を述べた文で、このアプリの予想ではなく、そうなると決まったという意味でもありません。」）`.claim-list`（`ul`。上に `--line-2` の罫。最初の 5 件）`.claim`（`li`。`data-id`・`data-stance`。下に `--line` の罫。幅によらず 1 列）`.claim-head`（主語と印。折り返す flex）`.claim-subject`（太字 15px。`subject` を `textContent` で）`.claim-stance`（`.tag`。`fact` は「現状の記述」、`possibility` は「見込み・懸念の記述」。文字だけで、色で分けない）`.claim-quote`（`blockquote`。`「」` で囲んだ原文を `textContent` で。15px・墨。左に 3px の `--line-2` の罫が引用の印で、藍は節の帯とリンクのものなので使わない。ブラウザ既定の余白は 0）`.claim-source`（`.note`「出典：」＋ `sourceLabel` ＋「（2026年3月）」。`source` が https の時だけラベルが `a[target=_blank][rel="noopener noreferrer"]`、それ以外は文字。日付は `formatClaimDate` で年・年月・年月日の日本語にし、読めない形は原文のまま）`.claims-more`（`details`。残りが無ければ `hidden`。`summary`「続きを見る（残り6件）」は `.board-more` と同じ作りで、`boardPanel.css` の同じ規則の組に入れてある。中は `.claim-list`。場所が変わると閉じ、同じ場所のまま前提だけ変えた時は開閉を保つ） | 公表資料が人口減少との関係を述べた文を、原文のまま、出典つきで並べる。「公表資料にこう書かれている」を見せるだけで、アプリは予想も断定もしない。`quote` と `subject` は一字も書き換えない（`textContent`）。並びは `claims.json` の順で、最初の 5 件のあとは「続きを見る」。複数の県にまたがる文はそれぞれの県に出る（JR四国の全体の文は徳島県・香川県・愛媛県・高知県の 4 県）。自分で書く文（見出し・注記・タグ・ラベル）には「残せない」「閉鎖」「撤退」「廃止」「消滅」「危機」「なくなる」「消える」「勧める」「べき」「おすすめ」を書かない（`boardClaims.test.ts` が、引用と主語を除いた節の文字とカードの文字を検査する。引用はそのまま出す）。`stance` は原文の述べ方（`fact`＝数字や現状、`possibility`＝懸念・見込み）で、アプリの判断ではない。ファイルが無い・読めない時は節ごと出ず、アプリはそのまま動く（`loadAll` が `console.warn` を 1 回出す）。カード自身の注記の上の罫は、「有名なもの」か「公表資料」の、最後に出ている節のあとに付く（`.landmarks:not([hidden]) + .claims[hidden] + .board-already`、`.claims:not([hidden]) + .board-already`） |

### 町の詳細（`townPanel.css`、`townPanel.ts`・`pyramid.ts`・`seriesChart.ts`・`facilityPanel.ts`・`burdenPanel.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 見出し | `.town` `.town-head` `.town-name`（明朝 26px）`.town-sub` `.town-hint` | 町名、県と区分、何も選んでいない時のヒント |
| 数字のタイル | `.town-kpis`（`.kpi-row` は常に 2 列）、5 枚目 `.kpi.town-support-kpi`（2 列をまたいで 1 行を使う）と、その下の 1 行 `.note.town-support-def` | 人口・2020 年比・65 歳以上の割合・0〜14 歳の割合、5 枚目が「高齢者1人を支える現役世代」（選んだ年の 15〜64 歳 ÷ 65 歳以上、小数 1 桁、単位 人。下に「2020年は◯.◯人」。2050 年より後はその行に試算の印 `.badge-estimate`。定義の 1 行「15〜64歳の人数 ÷ 65歳以上の人数」）。65 歳以上がいなければ「—」。町・県・日本のどれでも出る（県と日本は人数を足してから割る。町の比の平均ではない） |
| 割り振りの注記 | `.note.town-alloc-note`（数字のタイルの下、読み上げ領域にしない） | 地図が表示中の年の割り振り後で、この場所が割り振りに入っている間だけ「地図は割り振り後（28.8万人）です。この欄の数字は割り振り前です。」。タイルは割り振り前のまま |
| チャートの器 | `.chart-figure` `.chart`（inline SVG、幅 100%・最大 560px）`.chart-summary` `.chart-legend` `.chart-key`（`.key-estimate` `.key-baseline`） | 図と、その下の 1 文の要約と凡例。文字はすべて `--ink-2`、系列の色で文字を塗らない |
| 推移の 2 枚 | 人口 `.town-series`（`.series-figure` `.series-svg`）、高齢者1人を支える現役世代 `.town-support`（`.support-figure` `.support-svg`） | 同じ部品（`mountSeriesChart(host, spec)`。`SeriesChartSpec` が class・題・数字の書き方・表の文言を決め、既定は人口の `POPULATION_CHART`）。支える人数の図は、2050 年までの実線も公表値ではなくこのアプリの計算した年齢別の人口から（表の下の注記がそう言う）。表を開く文言は「支える人数の推移の数字を表で見る」（390px で 1 行）、表の数字は小数 2 桁。値の無い年（65 歳以上がいない）は線を切り、点と端の数字を描かず、表と要約は「—」。属性に NaN を書かない |
| 折れ線 | `.line .line-official / .line-estimate / .line-baseline`、`.dot .dot-official / .dot-estimate / .dot-baseline`、`.chart-grid` `.chart-border` `.chart-marker` `.chart-end` `.chart-marker-label` `.chart-unit` `.chart-caption` | 公式（墨・実線）、試算（藍・破線）、参考（灰・点線）。線 2px、点 8px 以上、2050 年の縦線 |
| ピラミッド | `.pyr-m` `.pyr-f` `.pyr-hit` `.pyramid-note` | 男は `--pyramid-m`、女は `--pyramid-f`。左右と「男」「女」の文字でも区別 |
| 表の折りたたみ | `.chart-table`（`details`）、推移の表の下に `.note.chart-table-note` | 図の数字を表でも読めるように。注記は「公式推計の列は国立社会保障・人口問題研究所の発表値。このアプリは公表された仮定から公式の方法で計算し直しているので、2050 年までの地図や町の数字は発表値と、町では数人、都道府県では数十人ほど違うことがある」（全 1,884 地域・2025〜2050 年の全期間で確かめた：町は最大 8.1 人（2040 年、横浜市緑区）、県は最大 47 人（2050 年、北海道）、全国は最大 17 人。`townPanel.test.ts` が毎年検査する）（`seriesChart.ts` の `TABLE_NOTE`。数字は変えない） |
| 文の折り返し | `.keep` | 数字と単位を途中で折らない |

### 前提を変える・人口の割り振り（`controlsPanel.css`、`controls.ts`・`allocationPanel.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 前提 | `.panel-lead`（2 文：2050 年までの数字は公式推計のまま動かない・ここで変えるのは 2050 年より後の前提・結果はこのアプリの試算。2026-11-07 までは 2 段落）`.controls-effect`（`div.panel-section`。導入のすぐ下＝つまみの上に置く結果：`h3.panel-section-title`「この前提での2100年」＋試算の印、`#ctl-tiles` の `.kpi-row`（日本全体と、選んだ県か町）、その下に `.note.controls-reference`＝`marksReference()`「参考：2020年は1億2,615万人（国勢調査）、2050年は1億469万人（公式推計）です。」）`.controls-groups`（`.field` を罫で区切る）`.field-tags` `.controls-actions` `.controls-status` `#ctl-error` `#ctl-infra-custom` | 導入、結果、スライダーと 2 択、戻すのボタン、状態の 1 行の順。結果はつまみを動かしながら見える位置（2026-11-07 までパネルの最後にあった） |
| 割り振りの入力 | `.alloc-form` `.alloc-regions`（`fieldset`）`.alloc-region`（チェックボックス 20px、行 40px）`.alloc-year` | 対象・割合・引く元 |
| 地図への反映 | `.alloc-map-actions` `.alloc-map-toggle`（`aria-pressed`。「地図に反映する」/「地図に反映中」）`.alloc-map-status`（`role=status`） | 押すと store の `allocation` に今の結果を置く。年・前提・入力が変わるたびに置き直す。外す・片付けると消す。反映中は地図で別の県や町を選んでも対象を変えない（印をたどってほかの県の輪を見るため）。反映していない時は、これまでどおり地図の選択が対象になる |

### AI に質問（`aiPanel.css`、`aiPanel.ts`・`aiTrace.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 入力 | `.ai-panel` `.ai-samples` `.ai-sample`（幅いっぱい・左揃え）`.ai-form` `.ai-input` `.ai-help` `.ai-counter`（`.is-over`）`.ai-input-msg` `.ai-new`（`.is-attention` は藍の 2px 枠） | 例の質問、自由入力、新しい質問。冒頭の説明は 1 段落 `p.panel-lead.ai-lead`（2026-11-07。それまでは説明と 2050 年の注記の 2 段落）：前半 `.ai-lead-main` は、ビルドが AI の接続先（`VITE_CHAT_ENDPOINT`）も `endpoint` も決めていない時は、答えるという約束ではなく、接続先が無い時の札と同じ 1 文（「このバージョンでは、AIへの質問は使えません…」）。決めた時は「日本語で質問すると…」（`PANEL_TEXT.intro`）。後半 `.ai-lead-after` は `PANEL_TEXT.after2050`「2050年までの数字は…公式推計、2050年より後の数字は、このアプリの試算です（予測ではありません）。」。例の質問のボタンはどちらでも付く。接続先が無いのに AI が答えた時は、最初の本物の答えのあとで前半が後者に替わる |
| 待ち | `.ai-status` `.ai-status-text`（`role=status`）`.ai-cancel` | 1 行と「やめる」 |
| 答え | `.ai-answers` `.ai-answer`（罫で区切る。`[data-role=ai-unavailable]` は AI の接続先が無い時の 1 文で、画面に 1 つだけ。ボタンは無いが、保存済みの答えが確認済みの質問がある間は、その質問のボタン `.ai-fail-samples` が付く）`.ai-question` `.ai-answer-head` `.ai-answer-text` `.ai-basis`（数字の確認を通った答えにだけ）`.ai-estimate`（確認できなかった数字のある答えと、2051 年以降の結果を持つ失敗の札に付く「2050年より後は、このアプリの試算です」の 1 行。答えの文が 2051 年以降の年を言う時も、札の上の印 `.badge-estimate` を出す）`.ai-message` `.ai-trimmed` `.ai-fail` `.ai-fail-samples`（保存済みの答えが確認済みの質問がある時だけ） | 新しい順。保存済みは `.tag`、試算は `.badge-estimate` |
| 使った道具 | `.ai-trace`（`details`）`.ai-trace-list` `.ai-trace-item` `.ai-trace-name` `.ai-trace-label` `.ai-trace-input` `.ai-trace-result`（`details`）`.ai-json`（`pre`、paper-2 の面）`.ai-copy-status` | 入力と結果をそのまま見せる |
| 地図・前提・割り振りへの橋 | `.ai-links`（「◯◯を地図で開く」）`.ai-scenarios` `.ai-scenario` `.ai-scenario-msg`（`data-role=apply-scenario`）`.ai-allocations`（`data-role=apply-allocation`、「この割り振りを地図に反映する」） | 道具の入力から計算し直して store に置く。モデルの文章は何も使わない |

## 帯・下層への入口・閉じたカード（`app.css`・`theme.css`、`app.ts` の `headerHtml`・`moreHtml`・`panelHtml`、文言は `sources.ts` の `NAV_*`）

| 要素 | class | 役割 |
|---|---|---|
| 帯 | `.app-head`（`--band` の地。中は `.app-head-inner`、`--page` 幅）`.app-title` | 読み込み中と失敗の画面の題だけ（2026-11-08 から。読み込み後は画面 1 の左上の小さな `h1`）。問い `APP_PROBLEM`・説明 `APP_LEAD`・`FOOT_NOTE` は画面に出さなくなったが、作者の文言として `sources.ts` に残してある |
| 下層（くわしく見る） | `.app-more`（`section`、`aria-labelledby`。画面 6 の後ろ）`.app-more-title`（`h2`「くわしく見る」、ゴシック 15px `--ink-2`）`.app-more-list`（縦に積む grid。中は閉じたカード 3 枚そのもの）`.app-more-desc`（`.sr-only`。各カードの直前に置く 1 行の説明 `NAV_DESCRIPTIONS`。カードの外に置くので、カードの名前にも中身にも混ざらない） | 町の詳細・前提を変える・人口の割り振りの 3 つが、見出しの下に縦に並ぶ（AI と出典は 2026-11-08 に画面 5・6 になった）。入口は 1 つ（2026-11-06 の「名前のボタンの行＋濃い帯」の二重表示を、2026-11-07 に本人指示で 1 つにした）。貼り付く帯も横に動く帯も無い |
| 閉じたカード＝軽い行 | `.panel.is-collapsed`（`theme.css`：`> :not(.panel-title)` を `display:none`、下の余白 0、地と枠を消して上に `--line-2` の罫 1 本（最後の行は下にも）。中身は DOM に残る）`.panel-toggle`（`h2.panel-title` の中の `button`、`aria-expanded`、`aria-describedby`＝`.app-more-desc`。閉じている間は 44px・列の端いっぱい・墨の文字、左に枠線で描く印（開くと向きが変わる）。中は `.panel-toggle-name`（明朝 18px、ボタンの名前）と `.panel-toggle-line`（ゴシック 14px `--ink-2`、`aria-hidden`。`NAV_SUMMARIES` の短い説明。入りきらなければ名前の下に折れる。開くと消える）。焦点の輪は藍の `--focus-ring` を行の内側に）。試算の印は閉じている間は普通の破線の印、開くと帯の中で明るい色 | 最初は全部閉じている。閉じた行の見出しを押すと、開いて（`is-collapsed` を外し `aria-expanded=true`）、`scrollIntoView`（動きを減らす設定なら即時）でその欄を窓の上へ（住所の # は変えない）、焦点はそのボタンのまま（`goToPanel`）。開いたカードの見出しを押すと、その場で閉じる（動かない）。開いたカードは上下に `--sp-3` の余白（隣の行の罫と枠が重ならない）。分かれ目・AI・出典は画面の中で、ボタンが無く常に開いている |

読み込み中と読み込み失敗の画面には帯（題だけ）を出す。説明は欄の内側が言っていること（人口の割り振りなら「全国の人口は変えずに」）と合わせ、何を残すかの助言や「残せない」の断定は書かない（`sources.test.ts` が語を検査する）。

### 町の数字（`placeFacts.css`、`placeFacts.ts`。2026-11-08 からページには出さない）

`#panel-facts`（`section.panel.place-facts`。町を選んでいる時だけ出し、県と日本では `hidden`）。見出しの帯は町の名前 `.place-facts-name` と年の印（`.badge-estimate` か `.badge-official`）。中は `dl.place-facts-list`＝2 列 × 2 行の格子で、4 枚のタイル `.place-fact`（`dt` が「2050年の人口」「2020年比」「65歳以上の割合」「高齢者1人を支える現役世代」＝13px の `--muted`、その下に `dd`＝明朝 26px の数字。単位は `.place-fact-unit`＝ゴシック 14px `--ink-2` で、`dd` の文字は「4.2万人」のまま。見出しが 2 行に折れても数字はタイルの下端にそろう）。一覧は自分の余白を持たず、カードの内側の余白（`.panel > *` の `margin-inline`）で縁から離す（2026-11-07 まで `margin: 0` がこの余白を打ち消し、縦 4 行が縁に付いていた。同日に 2 行 2 列へ）。数字は町の詳細の最初の 4 枚のタイルと同じ関数（`deriveTotals`・`ageShares`・`deriveSupport`）と同じ書き方（単位の分け方も `splitUnit`）で、`placeFacts.test.ts` が 3 町 × 3 年でタイルと照合する。

## 地図（`app.css`、`src/map/`）

| 要素 | class | 役割 |
|---|---|---|
| 面 | `.area`（fill を書き換えるだけで DOM は作り直さない）`.mesh`（紙色の境界）`.coast` | 2020 年比、または割り振りの変化 |
| 離島 | `.map-inset` `.inset-bg` `.inset-frame` `.inset-label` `.hit` | 遠い島は別の縮尺の枠に |
| 割り振りの行 | `.alloc-bar`（「地図に反映中の割り振り：」）`.alloc-bar-name`（「和歌山県 +10%」）`.alloc-bar-stale`（「この割り振りは◯年の計算です」）`.alloc-clear`（「割り振りを地図から消す」、40px。Esc でも消える：つまみ・チェックボックス・ボタンに焦点がある時も。文字を打つ欄（検索・質問の入力・選択欄・編集できる領域）の中の Esc は欄のもの、開いた dialog がある間と、ほかが処理した Esc も消さない） | 見出し（画面 1 の `h2`）の下、地図の上。消えた時にこの行にフォーカスがあれば、見出しへ移す |
| 地図の最初の跳び先 | `.skip-link`（`.map-stage` の最初の子。「地図をとばして、年の選択へ」。焦点が無い間は画面の外、焦点が来ると地図の左上に藍の枠のボタンとして出る（配置は変わらない）。押すと年のつまみに焦点を移す） | 地図の Tab 停止を飛ばす |
| 地図の色 | `.map-mode`（地図のすぐ下、凡例の塊 `.legend-block` の凡例の後ろの行＝2026-11-08 に凡例の下へ。`.map-mode-label`「色の見方」（14px `--ink-2`。`role=group` の `aria-labelledby` の先）と、共通の `.choice` の箱を外した軽い 2 択：文字だけ 14px `--ink-2`、選んだ方は `--ink` の太字に 2px の下線、各 44px、`aria-pressed`。「人口の変化」（既定）「高齢者1人を支える人数」。2026-11-07 までは地図の上の黒い塗りの分割ボタンだった） | 押すと store の `mapMode` を置く。割り振りを地図に反映している間は隠す（割り振りの色が優先。隠す時にこのボタンにフォーカスがあれば見出しへ移す）。割り振りを消すと、選んでいた色に戻る。「高齢者1人を支える人数」の間は、画面 1 の見出しが「2050年、日本で、高齢者1人を支える現役世代は1.4人。2020年は2.1人です。」（日本の地図では全国の値）、ツールチップと面の `aria-label` も同じ値（2050 年より後は試算の印、読み上げは「（このアプリの試算）」）、場所の読み上げも比になる |
| 凡例 | `.legend-block`（地図のすぐ下の塊。中は `.map-mode`（上の行）と `.legend`。1024px 以上は上に `--line` の罫）`.legend`（`data-mode="ratio" | "support" | "allocation"`）`.legend-title` `.legend-bar` `.legend-ticks` `.legend-tick` | 説明文 `.legend-title` は色の切り替えのすぐ下、墨で 15px（1024px 以上は 14px。2 つの色の向きが逆なので、読める大きさで置く）。2020 年比は「色は2020年の人口に対して、どれだけ残るか（薄いほど少ない）」（1280px 以上で 1 行。1024〜1279px は 2 行）、9 段の帯（段の境目ははっきり）、目盛は 1 段 3 か所「16分の1以下」（左端）「半分」（5/9 の段の境目）「同じ以上」（右端＝2020 年と同じ段と増えた段）。2026-11-07 までは 2 段 5 か所（「4分の1」「同じ」「増えた所は一番濃い」も）だった。割り振り中は「割り振りによる人口の変化（%）」に切り替わる。支える人数の間は「色は高齢者1人を支える人数（黒に近いほど少なく、大変）」、6 段の帯（左が黒に近い）、境目ごとに「0.8人」「1人」「1.5人」「2人」「3人」の目盛（端に寄せる目盛は無い）、読み上げは「左から 0.8人未満、0.8〜1人、1〜1.5人、1.5〜2人、2〜3人、3人以上」。目盛の箱の高さはどの凡例でも同じ（切り替えても年のつまみが動かない） |

キーボード：地図は Tab 停止が 1 つだけ（`tabindex` が 0 の地域は選択中の地域、無ければ最初の地域。ほかは -1）。地図の中は矢印キーで、その向きにある中心点のいちばん近い地域へ移る（`src/map/keyboard.ts` の `nearestInDirection`：その向きに厳密にある地域だけ、横のずれは 2 倍に数える、同点は Tab 順で先のもの、端では動かない）。PageUp・PageDown は Tab 順の前と次の地域（端で止まり、回り込まない）で、矢印のどれからも最寄りにならない地域（北海道の地図の札幌市南区）にも届く。Home・End は Tab 順の最初と最後。Enter・Space は選ぶ。矢印は離島の枠（沖縄県・遠い島々）と本体の間を跨がない（北海道から上に押して沖縄県に着かない）：本体からは枠の地域に着かず、枠の地域からは枠の中だけを動く。枠の地域は PageUp・PageDown・Home・End と検索で着く。Alt・Ctrl・Cmd・Shift つきのキーはブラウザに任せる。焦点を持った地域が Tab 停止になる（選択が変わった時だけ選択中の地域に戻す）。町は検索欄からも選べる。

目印だけの class（css の規則が無く、テストやスクリプトが要素を探すためのもの）：`.ai-allocations` `.ai-basis` `.ai-cancel` `.ai-form` `.ai-links` `.ai-message` `.ai-trace` `.ai-trace-result` `.ai-trimmed` `.alloc-clear` `.alloc-map-actions` `.alloc-map-status` `.alloc-map-toggle` `.alloc-table-hidden` `.alloc-table-visible` `.head-basis` `.map-inset`。見た目は一緒に付く共通の class（`.btn`・`.note`・`.data-table` など）が決める。`.marker-mixed`（増えた町と減った町の両方がある県）は独自の色を持たず、印の文字は墨のまま。

## 数字と文言

- 人口は `formatPop()`（`src/ui/format.ts`）：8,340人 / 4.2万人 / 1,190万人 / 1億2,615万人。高齢者1人を支える人数は `formatSupport()`：2.1人 / 0.8人（小数 1 桁）、表は `formatSupportExact()`：2.08（小数 2 桁、単位は列名に）。比が出せない時は「—」（Infinity や NaN を出さない）。比に良い・悪いを付けない。増減は `formatPct()`：−31.5% / +2.5%（マイナスは U+2212）。割り振りの変化は `formatDeltaPct()`：+10.0% / −0.04% / ±0%。
- 色の幅（`allocationScale`）は最大の変化を画面と同じ小数 1 桁に丸めてから 5・10・20・30・50・100 と比べる。計算の誤差（10.000000000000018）や人数の丸め（10.0001）で +10% の割り振りが ±20 にならない。
- 2050 年より後の数字には必ず試算の印を付け、「予測」と書かない。文言の正本は `src/ui/sources.ts`（`ESTIMATE_NOTE`・`OFFICIAL_NOTE`・`badgeFor`・出典）。年のつまみの下の注記（`.year-note`。つまみの下に 1 行、年の塊の幅いっぱい。1024px 以上は 13px）は 2050 年までが `OFFICIAL_NOTE`「2050年まで公式推計（国立社会保障・人口問題研究所）」（略称を使わず 1 行。2026-11-07 までは「2050年までは国立社会保障・人口問題研究所の公式推計」で 2 行だった）、2050 年より後は試算の印と `ESTIMATE_NOTE`「2050年より後は、このアプリの試算です（予測ではありません）」。「社人研」とは書かない。
- 出典（フッター）は `SOURCES`（`src/ui/sources.ts`）が正本。どの出典も、加工して作成したと書き、出典のページの URL を「文字が URL そのもののリンク」（`target=_blank` `rel=noopener`）で見せ、取得日（`docs/sources.md` の日付）を添える。測量法の承認の行は境界の出典の最後に残す。1 件は「何か」「ページと取得日」「承認の行」を `.src-text` `.src-where` `.src-approval` の 3 段に積む（スマホ幅でも読め、URL は途中で折れる）。人口の出典は「国立社会保障・人口問題研究所がこのアプリの内容を保証するものではありません」で終える（`docs/sources.md` と README のとおり）。長い句は `word-break: auto-phrase`（Chromium）で文節で折る。
- 〔2026-11-08 に画面から外した〕見出しの下の問い `.app-problem`（`APP_PROBLEM`＝`src/ui/sources.ts` が文言の正本）：「いま、何を残したいかを決めておかなければ、あとから選べなくなるかもしれません。わたしたちは何を残すのか。2100年の数字から考えます。」（2026-11-06 に本人が選んだ文）。題と説明の下に 1 行を専有（`flex: 1 0 100%`）、本文の墨（`--ink`）、15px、文節ごとの `.keep`（`phraseHtml`）。1024px 以上は 1 行（約 930px）、それより狭い画面は 44em で折り返す（390px で 4 行）。問いかけで、残す・残さないを勧めず、「残せない」とも書かない。一人称は「わたしたち」（漢字の「私」は使わない）。読み込み中・失敗の画面も同じ見出しを使う。
- 「いま、この規模の市町村は、1人あたりこれだけ使っています」の文言：金額は令和6年度の決算の実績で、2050年より後を選んでも「試算」は人口（規模を選ぶ数）にだけ付ける。「この町は費用がかかりすぎる」「集約すれば減る」「残すべき」のような価値の判断・因果・勧めは書かない。町自身の値が無い場所（政令指定都市の区、浜通り地域）は、無い理由を 1 文で言う。
- 丸数字・矢印記号・英語の大文字ラベルは使わない。

## チャート（推移・ピラミッド）

- インライン SVG。軸と目盛線は `--grid`、文字は `--ink-2`（系列の色で文字を塗らない）。線は 2px、点は 8px 以上。
- 推移は 1 軸。公式（墨・実線）、試算（藍・破線）、参考（灰・点線）の 3 本まで。人口と高齢者1人を支える人数は別々の図（2 つの軸を 1 枚に重ねない）。凡例は必ず置き、2050 年の縦線で公式と試算の境を示す。選んだ年のラベルは、その年が横軸の目盛（2020・2040・2060・2080・2100）と重なる時は出さない（同じ「2100年」を 2 回印字しない）。
- ピラミッドは男 `--pyramid-m`、女 `--pyramid-f` を左右に。年齢の階級は 5 歳ごと 20 区分。
- SVG の中の生の数値（幅・行の高さ・余白）は、ファイルの先頭の名前付き定数（`W`・`ROW`・`BAR`・`TOP`・`RIGHT` など）にだけ書く。描画の式に数字を直に書かない。色は css の class で付け、属性に色を書かない。

## 状態と更新

- 状態は `store`（`src/ui/state.ts` の `createAppStore`）。`store.get()` で `year`・`scenario`・`series`・`selectedPref`・`selectedArea`・`allocation`・`mapMode` を読み、`store.subscribe((s, prev) => …)` で描き直す。`store.set(patch)` は適用されたら `true`、何も変わらない・拒否されたら `false` を返す。`prev` はその購読者が前に受け取った状態。購読者の中で `set` してよい（割り振りのパネルは年の変化を受けてその場で置き直す）：その時は全員に新しい状態がすぐ届き、まだ受け取っていない購読者にはいくつかの変化が 1 回にまとまって届く（打ち消し合って何も変わらなければ呼ばれない）。古い状態で終わる購読者は出ない。通知の途中で購読をやめた購読者には、その通知はもう届かない。
- 町を選ぶ時は `store.set({ selectedArea: code })` だけでよい。store が `selectedPref` をその町の県にそろえる（県の地図・パンくず・戻るボタンも付いてくる）。`store.set({ selectedPref })` で県を変えると、その県に属さない町の選択は消える。`selectedPref: undefined` で日本に戻る（町の選択も消える）。無い地域コード・県コードは拒否される（状態は変わらず、通知も無く、console.warn が出る）。`src/ui/nav.ts` の `pickArea`・`pickPref`・`goUp`・`toJapan` は同じ patch を作る便利関数。
- `store.set({ scenario })` を呼ぶと、`series` が同じ通知の中で更新されて届く（自分で runner を呼ばない）。範囲外・NaN・未知の migMode は拒否され、前の値が残る（通知なし・console.warn）。値が同じ scenario を入れ直しても通知は無い。スライダーの min/max は `SCENARIO_LIMITS`（`src/data/runner.ts`）に合わせる。
- `year` は 2020〜2100 の 5 年刻みだけ受け付ける（それ以外は拒否）。
- `mapMode` は地図の色：`'change'`（2020 年比、既定）か `'support'`（高齢者1人を支える人数）だけ受け付ける（それ以外は拒否、console.warn）。年・前提・割り振りが変わっても残る。割り振りが地図にある間は割り振りの色が優先し、消えると戻る。
- 支える人数は `deriveSupport(series, data.groups)`（`src/ui/derive.ts`）：地域・県・全国の年ごとの比（`deriveTotals` と同じ形、`series` ごとに 1 回）。計算そのものは `src/engine/aggregate.ts` の `supportRatio`・`supportRatioOf`（15〜64 歳＝階級 3〜12、65 歳以上＝階級 13 から。65 歳以上が 0 なら NaN）。文言は `src/ui/support.ts`。
- 年ごとの合計は `deriveTotals(series, data.groups)`（`src/ui/derive.ts`）。`series` が同じ間は同じ結果が返るので、呼ぶたびに計算し直さない。
- 描き直しは変わった所だけ。DOM を作り直さず、文字と属性を更新する。読み上げの領域（`role=status`・`aria-live`）は意味が変わった時だけ書き換える。

## 確認（納める前）

- `npm run typecheck && npx vitest run && npm run build`。
- Playwright で 390px を先に、次に新しいタブで PC 幅（追従）。横スクロールが無いこと、文字が 4.5:1 以上、面の色が 3:1 以上、触れる所が 40px 以上。
- 試算の印が 2050 年より後に出ること、「予測」の語が無いこと。
