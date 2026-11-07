# 画面の設計（Task 8 で決めた正本。パネル（Task 9・10・13）はこれに従い、足した部品もここに載せる）

このアプリの見た目は 1 回だけ決める（Ruling 23）。トークンは `src/ui/theme.css`、骨組みは `src/ui/app.css`、パネルの配置の糊は各パネルの css（`townPanel.css`・`controlsPanel.css`・`aiPanel.css`）。ここにある部品だけを組み合わせ、新しい色・書体・影・角丸を発明しない。

## 方向

- 題材は「2100年の日本」の人口。市民・自治体職員・審査員が読む、落ち着いた公的データの刊行物の調子。
- 紙色の地、墨の文字、藍のアクセント 1 色。地図の色はデータの色で、UI の装飾には使わない：2020 年比は藍 1 色の濃淡（残る人が少ないほど薄い）、高齢者1人を支える人数は灰から黒（支える人が少ないほど黒に近い）、割り振りの変化だけ赤錆（減少）と青（増加）。
- 見出しと大きな数字は明朝、それ以外はゴシック。等幅は使わない。英語の大文字の小見出し、カード型の影の連なり、グラデーションの帯は使わない（右の列のパネルは枠と藍の帯で区切る 4 枚のカードで、影は付けない）。
- 目立たせるのは地図と年のつまみだけ。年を動かすと地図の色が 2020 年比で薄れていく、これが記憶に残る瞬間。ほかは静かに。
- 「試算」は破線で示す。年のトラックの 2050 年より後は破線、試算の印 `.badge-estimate` も破線。「割り振り後」は藍の薄い面 `.badge-alloc`。2050 年より後は試算の印の隣に足し、置き換えない（割り振り中も「試算」が出る）。2050 年まではこの印が公式推計・実績の印に代わる（割り振り後の数字は公式の値ではないため）。
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
| アクセント（リンク・主ボタン・フォーカス） | `--accent` / `--accent-soft` | `#2b4c7e`（7.9:1）/ `#e4eaf3` |
| 減少（地図の赤錆。施設が目安を下回る印、割り振りで減った町の輪） | `--decline` / `--decline-deep` / `--decline-soft` | `#a43d2b` / `#721d14` / `#f2ddd6` |
| 増加（地図の青。割り振りで人口の目安を下回らなくなった町の輪） | `--growth` / `--growth-soft` | `#376daf` / `#dde6f2` |
| 地図の中立（値が無い所・割り振りで変化 0） | `--map-neutral` | `#d0c9c4` |
| 地図の「2020 年比」の 9 段（薄い → 濃い） | `--change-1` … `--change-9` | `#ffffff` `#dee4ed` `#bec9da` `#9fafc8` `#8196b5` `#637da3` `#476490` `#2b4c7e` `#012a64`。`--accent` を**白**に OKLab で 0・14.3・28.6・42.9・57.1・71.4・85.7・100・120 % 混ぜた色（新しい色相は足さない。120 % は同じ色相を一段濃くした外挿で、122 % からは sRGB の外に出る）。隣り合う段は OKLab の明度で 0.083 ずつ（WCAG のコントラスト 1.28〜1.43、「増えた所」だけ 1.61）。いちばん薄い段は白そのもの（無色。紙に対して 1.09:1 なので、地図の線が形を作る）、「同じ」の段が `--accent` そのもの、「増えた所」がいちばん濃い。濃淡の幅は明度 1.0〜0.30（最初の版は 0.90〜0.33。作者の指示「濃淡の幅が狭い・薄いところは無色まででよい」、2026-11-06 夜）。正本は `src/map/colors.ts` の `CHANGE_COLORS` |
| 地図の「高齢者1人を支える人数」の 6 段（少ない → 多い） | `--support-1` … `--support-6` | `#14181f` `#3b3f45` `#676a70` `#97999d` `#cacbcd` `#ffffff`。`#14181f`（黒に近い色の上限）を**白**に OKLab で 100・80・60・40・20・0 % 混ぜた色。隣り合う段は OKLab の明度で 0.158 ずつ（WCAG のコントラスト 1.62〜1.95）、いちばん薄い段は白そのもの（無色。紙に対して 1.09:1 なので、地図の線が形を作る）、支える人が少ないほど黒に近い。正本は `src/map/colors.ts` の `SUPPORT_COLORS` |
| 地図の線（2020 年比の間） | `--map-line-pale` | `rgba(27, 36, 48, 0.32)`。薄い段がほぼ紙なので、紙色の県境と `--line-2` の海岸線は消える。墨の半透明の線はどの段より暗い（面に対して 1.1〜1.9:1）。`app.css` が凡例の `data-mode="ratio"` の間だけ `.mesh` と `.coast` に当てる。ほかの色（支える人数・割り振り）は紙色の県境のまま |
| 割り振りの減少（赤錆。施設が目安を下回る印、割り振りで減った町の輪） | `--decline` / `--decline-deep` / `--decline-soft` | `#a43d2b` / `#721d14` / `#f2ddd6` |
| 割り振りの増加（青。割り振りで人口の目安を下回らなくなった町の輪） | `--growth` / `--growth-soft` | `#376daf` / `#dde6f2` |
| 折れ線：公式 / 試算 / 参考 | `--series-official` / `--series-estimate` / `--series-reference` | 墨の実線 / 藍の破線 / `#8a8378` の点線 |
| 人口ピラミッド：男 / 女 | `--pyramid-m` / `--pyramid-f` | `#2b4c7e`（紙に 7.9:1）/ `#6085b9`（紙に 3.5:1、paper-2 に 3.2:1。男女は左右と「男」「女」の文字でも区別） |
| チャートの目盛線 | `--grid` | `--line` と同じ |
| 書体 | `--font-display` / `--font-body` | 明朝（Hiragino Mincho ProN, Yu Mincho）/ ゴシック（Hiragino Sans, Yu Gothic） |
| 文字の大きさ | `--fs-12` … `--fs-56` | 12 は注記だけ。本文 16、パネル見出し 20、大きな数字 28、年 44 |
| 余白 | `--sp-1` … `--sp-8` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| 角丸・影・フォーカス | `--radius` 4px、`--shadow` 1 段、`--focus-ring` 2px の藍 | 影はツールチップと検索候補だけ |
| 触れる大きさ | `--touch` | 44px |

地図の色の計算は `src/map/colors.ts`。2020 年比は `changeColor(ratio)`：区切り 1/16・1/8・1/4・0.4・1/2・0.7・0.85・1 の 9 段（`CHANGE_BREAKS`。1/16 から 1/4 までと 1/2 が 2100 年の町（中央値 0.25）を、0.4 が 2100 年の県（47 のうち 35 が 1/4〜1/2 に入っていたのを 4・20・15・7・1 に分ける）を、1/2〜1 の中の 2 つの区切りが 2050 年の県（0.58〜1.03）を分ける。根拠の数字は `colors.ts` の注記）。残る人が少ないほど薄く、2020 年と同じ（0.85〜1）が藍そのもの、1 より多い（増えた所）がいちばん濃い。値が無い所は `--map-neutral`。割り振りの変化は `allocationColor(percent, scale)`（0 を中心に ±scale %、赤錆と青の 2 本の腕。scale は `allocationScale()` が最大の変化から 5・10・20・30・50・100 に丸める）。高齢者1人を支える人数（15〜64 歳 ÷ 65 歳以上）は `supportColor(ratio)`：区切り 0.8・1・1.5・2・3 の 6 段（`SUPPORT_BREAKS`。全 1,884 地域の 2020 年と 2100 年の分布から決めた。根拠の数字は `colors.ts` の注記）、支える人が少ないほど黒に近く（上限 `#14181f`）、多いほど薄く、いちばん多い段は白（無色）。段は画面に出す小数 1 桁の値で決める（「1.0人」と出る町は「1〜1.5」の段）。65 歳以上がいない地域（実データには無い）は `--map-neutral` の灰色。良い・悪いの色にはしない（赤錆や青は使わない）。

## 配置（slots）

- 最初の画面に出すのは 4 つだけ（作者の指示 2026-11-06「大切なものから順に、大切なものだけ」）：題と問いの 1 文、地図と年と凡例、分かれ目、下層への入口「くわしく見る」。町を選んだ時の基本の数字 4 行（`#panel-facts`）は分かれ目の上。町の詳細・前提を変える・人口の割り振り・AIに質問・出典は下層で、最初は閉じている（`.panel.is-collapsed`：中身は DOM に残し、見出しの帯だけ出す）。
- 390px：1 列。上から 帯（題・問い。問いは 14px で 3 行）→ 場所の行（パンくず・戻る。日本全体では出ない）→ 検索 → 場所の数字 →（割り振り中は 割り振りの行）→ 地図（600px 未満は窓の端から端まで）→ 色の見方（2 択）と凡例 → 年 → `#panel-facts`（町の数字。町の時だけ）→ `#panel-board`（分かれ目）→ `section.app-more`（くわしく見る。中に `#panel-town` → `#panel-controls` → `#panel-allocation` → `#panel-ai` → `#panel-sources`（出典）が軽い行として縦に並ぶ）。
- 1024px 以上：帯は窓の端から端まで（`--band` の地。中は `--page` 幅）。題の行と問いの行（約 92px）。その下は 2 列（地図 3 : パネル 2）。左の地図の列の先頭は `.map-top`（grid：左に場所の行と場所の数字、右に検索。日本全体では場所の行が無いので、場所の数字が検索と同じ段になり、「日本　2050年 1億469万人　2020年比 −17.0%　公式推計」が 1 行）。地図の列は `position: sticky` で、帯が流れ去ったあとは地図・色の見方と凡例・年が 1 画面に収まる。最初の画面（動かさない状態）で帯・地図・凡例・年が収まるよう、地図の高さは `calc(100vh - 340px)` まで（帯 約 92px・場所の数字と検索 約 52px・地図の下の塊（色の見方と凡例、年。左右に並べて 約 165px）・下の余白の分。2026-11-07 に 395px から 340px にした：色の切り替えが地図の上から下へ移り、日本全体のパンくずが消えた分。1024〜1279px は場所の数字と凡例の題と年の注記が 2 行になるので 400px）。`appCss.test.ts` が検査する。右の列に、町の数字・分かれ目・「くわしく見る」（閉じたカード 5 枚＝軽い行。出典もここ）が縦に並ぶ。
- パネルは `(el: HTMLElement, ctx: PanelContext)` で `el`（既にある `<section class="panel" id="panel-…">`）の中身を置き換え、片付けの関数を返す。`el` 自体の class と id は変えない。見出しは `h2.panel-title` を 1 つ残す（試算の印は `h2` の中に足す）。
- 取り付けは `src/ui/app.ts` の `mountPanels(ctx, slots)`（「Panel registry」の印の付いた 5 行。返った片付けの関数は `destroy()` が呼ぶ）。
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
| 表 | `<div class="table-wrap"><table class="data-table"><thead><tr><th>施設</th><th class="num">目安</th></tr></thead><tbody><tr><td>…</td><td class="num">5,000人</td></tr></tbody></table></div>`。数字は `.num`（右揃え・等幅数字） |
| 施設の状態 | `<span class="tag tag-ok">人口の目安を上回る</span>` / `<span class="tag tag-edge">境目</span>` / `<span class="tag tag-below">人口の目安を下回る</span>` |
| 試算・公式・実績・割り振りの印 | `<span class="badge-estimate">試算</span>` / `<span class="badge-official">公式推計</span>`（2020 年は「実績（国勢調査）」、`badgeFor(year)` が選ぶ）/ `<span class="badge-alloc">割り振り後</span>`（数字が割り振りを含む時だけ。2050 年より後は試算の印の後ろに足す。2050 年まではこれが公式・実績の印に代わる。数字が実際に変わる場所だけ） |
| 注記 | `<p class="note">…</p>`、`<div class="notice">…</div>`、仮定の注意は `<div class="notice notice-estimate">…</div>`（破線） |
| ボタン | `<button class="btn">…</button>`、主ボタン `.btn.btn-primary`（1 画面に 1 つ）、静かな導線 `.btn.btn-quiet`、正方形 `.btn.btn-icon`。文言は動詞（「計算し直す」「元に戻す」）。押した状態を持つボタンは `aria-pressed` |
| 並んだボタン | `<div class="actions">…</div>` |
| スライダー | `<div class="field"><label class="field-label" for="x"><span>出生率の倍率</span> <span class="field-value">1.00</span></label><input id="x" type="range" class="range" min="0.6" max="1.4" step="0.05"><p class="field-help">2050年より後の期に掛ける</p></div>` |
| 2 択・3 択 | `<div class="choice" role="group" aria-label="人口移動"><button aria-pressed="true">据え置き</button><button aria-pressed="false">2100年に向けて止まる</button></div>`。縦に積む `.choice.choice-stack`、幅いっぱい `.choice.choice-wide`（`controlsPanel.css`）。枠は overflow で切らないので、端のボタンでもフォーカスの輪が見える |
| 文字入力 | `<input class="input" type="text">`、`<select class="input">`、`<textarea class="input">` |
| 折りたたみ | `<details class="fold …"><summary>その他の施設を見る</summary>…</details>`。`summary` は 44px・藍の文字。矢印の記号は書かず、`::before` の枠線で印を描く。共通の見た目は `theme.css` の `.fold`（2026-11-07。新しい折りたたみはこの class を付ける。`townPanel.css` の `.chart-table` / `.facility-others`、`boardPanel.css` の各折りたたみは同じ印を自分の css で描く） |
| 読み込み中 | `<div class="skeleton" style="height:120px"></div>` |
| 画面の外に出す文字（読み上げ用） | `.sr-only` |

## パネルが足した部品の族（各パネルの css。値は全部トークン）

### 分かれ目（`boardPanel.css`、`boardPanel.ts`。文言と計算は `board.ts`、年のまたぎは `src/engine/crossings.ts`）

右の列の先頭のカード（`#panel-board`、見出し「分かれ目」）。選んでいる場所（日本全体・県・町）について、いつ・どこで・何が人口の目安を下回るかを、短く見せる。動詞はいつも「人口の目安を下回る」で、「残せない」「閉鎖」「撤退」「廃止」は書かない（説明の 1 文 `BOARD_GUIDE_NOTE` が、目安は国土交通省の統計で、下回っても施設がなくなると決まるわけではないと言う）。年表と行には、名前のある有名なもの（神社仏閣・施設の固有名）を出さない。それらは、行の一覧のあとの節「ここにある有名なもの」に、その場所にあるものとして並べるだけで（下の表の最後の行）、行や目安と結びつけない（作者の決定 2026-11-06「まず統計で言える範囲で作る。名前のあるものは『その町にあるもの』として並べるだけ」）。その次の節「公表資料に書かれていること」（県を選んだ時だけ）は、名前のあるものについて公表資料が人口減少との関係を述べた文を、原文のまま・出典つきで出すだけで、アプリが予想や断定をするのではない（作者の決定「まず統計で言える範囲で作る。次に、根拠の資料を調べて、出典つきで、名前のあるものの『維持が難しくなる可能性』を足す」）。アプリ自身の文には、名前のあるものと人口や年を結びつけた予想・断定を書かない。

| 族 | 主な class | 役割 |
|---|---|---|
| 見出しの文 | `.board-heading`（`h3`、明朝 18px） | 「日本全体で、人口の目安を下回っていく順番」「和歌山県で、…」「田辺市で、人口の目安を下回る施設と、その年」（`boardHeading`） |
| 年表の帯 | `.board-years`（`figure`）`.board-years-lead`（`figcaption`、`.note`）`.board-bars`（`ol`、16 列の grid、`aria-hidden`：数字は下の 1 文と表が言う）`.board-bar`（`li`。`data-year`、高さは `--board-h`＝最大に対する %。2050 年より後は `.is-estimate`）`.board-bar-value`（棒の上の数字。最大の棒と、表示中の年の棒だけ）`.board-bar-fill`（2050 年までは `--ink-2` の塗り、`.is-estimate` は `--accent-soft` の面に `--accent` の破線の縁＝年のトラックと同じ「試算」の作法）`.board-bar-year`（基線の罫と 2030・2050・2070・2100 の目盛）`.board-years-summary`（「いちばん多いのは2045年（6町）。」）`.board-table`（`details.chart-table`「棒の数字を表で見る」。全 16 年の数と単位、試算の行は `.is-estimate`） | 5 年ごとに、新しく目安を下回る町の数（県・日本：主な 8 施設のいずれか、町は 1 回だけ数える）か、施設の数（町）。表示中の年の棒は `aria-current="true"`：塗りが `--ink`、基線に 3px の印、数字を出す。年を動かしても帯は作り直さず印だけ動く |
| 行 | `.board-list`（`ol`、上に `--line-2` の罫。空なら消える）`.board-row`（`li`。`data-year`・`data-facility`・`data-area`＝行の町）`.board-row-head`（2 列の grid：年 6.5em と中身）`.board-row-year`（明朝 18px。2050 年より後は `.badge-estimate`。直前の行と同じ年の行は `li.is-same-year` で、年を `--muted`・通常の太さに薄める（文字は残す＝読み上げは毎行の年を言う。`repeatedYears`。一覧ごとに最初の行は必ず濃い）。同じ年の行がひとまとまりに見える）`.board-row-facility`（太字 15px）`.board-row-towns`（14px `--ink-2`。「美浜町 ほか1町」、日本全体では「売木村（長野県） ほか2町」） | 県・日本：主な 8 施設の、いちばん早い順に `BOARD_ROWS`＝3 行（2026-11-07 までは 6 行。`groupCrossings`：年 → 主な施設 → 施設の順。行の町は目安をまたぐ前にいちばん人口が多かった町）。残りは `.board-more`（`details`「続きを見る（残り59件）」）。町：主な 8 施設の行を先に、残りは `.board-others`（`details`「その他の施設（18）」）。無ければ `.board-none` の 1 文 |
| 注記 | `.board-already`（短い 1 行「2020年の時点で、すでに下回る：11種類」／「…：470町」）`.board-guide`（`details`。`summary`「人口の目安とは」（`BOARD_GUIDE_SUMMARY`）、最初は閉じている。中に `.board-essential-note`（県・日本だけ）と `.board-note`（`BOARD_GUIDE_NOTE`、文節ごとの `.keep`。文言は変えない）。2026-11-07 に 3 段落を 1 行＋開閉にした） | 2020 年に既に下回っているものは、またぎの行に入れず別に数える。何の目安か・8 施設で数えていることは開閉の中が言う |
| ここを残すには（`boardKeep.ts`） | `.board-keep`（各行の `details`。`summary` は「ここを残すには」、読み上げ用に「（美浜町・銀行（中央銀行を除く））」）`.board-keep-body`（開いた時に 1 回だけ作り、その時に計算する）`.board-keep-lead`（「美浜町が、2025年に銀行（中央銀行を除く）の人口の目安（6,500人）に届くには」。2050 年より後は `.badge-estimate`）`.board-balance`（左右 2 列、上下に罫）`.board-balance-side.is-keep`（右寄せ）`.is-cost` `.board-balance-title`（「ここを残すには」「代わりに」）`.board-balance-amount`（明朝 26px「+約93人」「−約93人」。同じ数）`.board-balance-bar.is-gain`（`--growth` の青、列いっぱい）`.is-loss`（`--decline` の赤錆、列いっぱい。2 本は同じ長さ＝全国の人口は変わらない）`.board-balance-who`（「美浜町に、ほかの町から移ってくる人」「ほかの町から、人口に比例して減る人」）`.board-keep-effect`（`keepEffectLine`：「このとき、ほかの19町が、いずれかの施設の人口の目安を下回ります。」）`.board-keep-top-lead` `.board-keep-top`（`keepTopText`、上位 3 施設）`.board-keep-choice`（明朝 16px「どこかを残すと、別のどこかが目安を下回ります。選ぶのはあなたです。」）`.board-keep-actions`（`.btn` の「地図に反映する」と `.board-keep-status`＝`role=status`）`.board-keep-message`（`.notice`。人数が大きすぎる時 `KEEP_TOO_LARGE`、下回っていない時 `BOARD_KEEP_NOT_BELOW`）`.board-keep-limits`（`KEEP_LIMITS`） | 行の町・施設・年で `computeKeep`（町の詳細の「この目安に届くには」と同じ計算）。開くのは同時に 1 つ（開くと他は閉じる。場所や前提が変わると行ごと作り直すので全部閉じる）。ボタンは `keepOverlay()` の重ねと、その行の年を 1 つの patch で `store.set({ year, allocation })`（地図はその年の割り振り後になり、「この割り振りは◯年の計算です」は出ない）。押した後、スマホで地図が画面の外なら地図の先頭へ動かす。何を残すべきかは言わない |
| ここにある有名なもの（`landmarks.css`、`landmarks.ts`。データは `public/data/landmarks.json`＝220 件・47 都道府県すべてに 3 件以上、形の検査と索引は `src/data/landmarks.ts`） | `.landmarks`（`div.panel-section`。行の一覧とその折りたたみ（`.board-others`）のあと、次の節 `.claims` のまえ。県か町で項目がある時だけ出し、日本全体と項目の無い町では `hidden`＝「ありません」とは書かない。下に `--sp-5` の余白で、カード自身の注記と離す）`.landmarks-title`（`h3.panel-section-title`「この県にある有名なものの例」「この町にある有名なものの例」）`.landmark-list`（`ul`。上に `--line-2` の罫。県は `.is-pref`、町は `.is-area`）`.landmark`（`li`。`data-id`・`data-area`。下に `--line` の罫。600px 以上の県の一覧は 2 列の grid：場所 6.5em と中身＝行の「年 6.5em と中身」と同じ骨格。それ未満と町の一覧は 1 列で、場所は名前の上の 1 行）`.landmark-place`（県だけ）`.landmark-town`（`button`。町名＋読み上げ用の「を選ぶ」。藍の下線の文字ボタン＝パンくずと同じ語彙。押すと `store.set(pickArea(...))` でその町を選ぶ）`.landmark-body` `.landmark-head`（名前と種類。折り返す flex）`.landmark-name`（太字 15px。長い名前は `overflow-wrap: anywhere` で折り返す）`.landmark-kind`（`.tag`。種類は文字だけで、色で分けない）`.landmark-summary`（15px。データの `summary` をそのまま `textContent` で）`.landmark-source`（`.note`「出典：」＋ `sourceLabel`。`source` が https の時だけ `a[target=_blank][rel="noopener noreferrer"]`、それ以外は文字）`.landmarks-note`（`.note`「完全な一覧ではありません。人口の目安を下回るかどうかとは関係なく、そこにあるものを示しています。」）。行の `.board-keep-body` の最後に `.note.board-keep-landmarks`（「この町にある有名なもの：熊野本宮大社、滝尻王子」。4 件以上は 3 件＋「ほか N件」。項目の無い町では出さない） | 選んだ県か町にある有名なものを、名前・場所・種類・1 文の事実・出典つきで並べる。並べるだけで、「残せない」「撤退する」「廃止になる」などの断定も、人口や年と結びつけた見込みも書かない（根拠のデータが無い）。名前と 1 文はデータのまま（書き換えない）。並びはファイルの順。ファイルが無い・読めない時は節ごと出ず、アプリはそのまま動く（`loadAll` が `console.warn` を 1 回出す） |
| 公表資料に書かれていること（`claims.css`、`claims.ts`。データは `public/data/claims.json`＝50 件・22 都道府県、形の検査と索引は `src/data/claims.ts`） | `.claims`（`div.panel-section`。「ここにある有名なもの」のあと、`.board-already` のまえ。**都道府県を選んだ時だけ**、その県に項目がある時に出し、日本全体・町（県の項目は町に貸さない）・項目の無い県では `hidden`＝「ありません」とは書かない。下に `--sp-5` の余白）`.claims-title`（`h3.panel-section-title`「公表資料に書かれていること」）`.claims-note`（`.note`。見出しの直下に 1 つ：「各資料の原文を引用しています。人口減少との関係を述べた文で、このアプリの予想ではなく、そうなると決まったという意味でもありません。」）`.claim-list`（`ul`。上に `--line-2` の罫。最初の 5 件）`.claim`（`li`。`data-id`・`data-stance`。下に `--line` の罫。幅によらず 1 列）`.claim-head`（主語と印。折り返す flex）`.claim-subject`（太字 15px。`subject` を `textContent` で）`.claim-stance`（`.tag`。`fact` は「現状の記述」、`possibility` は「見込み・懸念の記述」。文字だけで、色で分けない）`.claim-quote`（`blockquote`。`「」` で囲んだ原文を `textContent` で。15px・墨。左に 3px の `--line-2` の罫が引用の印で、藍は節の帯とリンクのものなので使わない。ブラウザ既定の余白は 0）`.claim-source`（`.note`「出典：」＋ `sourceLabel` ＋「（2026年3月）」。`source` が https の時だけラベルが `a[target=_blank][rel="noopener noreferrer"]`、それ以外は文字。日付は `formatClaimDate` で年・年月・年月日の日本語にし、読めない形は原文のまま）`.claims-more`（`details`。残りが無ければ `hidden`。`summary`「続きを見る（残り6件）」は `.board-more` と同じ作りで、`boardPanel.css` の同じ規則の組に入れてある。中は `.claim-list`。場所が変わると閉じ、同じ場所のまま前提だけ変えた時は開閉を保つ） | 公表資料が人口減少との関係を述べた文を、原文のまま、出典つきで並べる。「公表資料にこう書かれている」を見せるだけで、アプリは予想も断定もしない。`quote` と `subject` は一字も書き換えない（`textContent`）。並びは `claims.json` の順で、最初の 5 件のあとは「続きを見る」。複数の県にまたがる文はそれぞれの県に出る（JR四国の全体の文は徳島県・香川県・愛媛県・高知県の 4 県）。自分で書く文（見出し・注記・タグ・ラベル）には「残せない」「閉鎖」「撤退」「廃止」「消滅」「危機」「なくなる」「消える」「勧める」「べき」「おすすめ」を書かない（`boardClaims.test.ts` が、引用と主語を除いた節の文字とカードの文字を検査する。引用はそのまま出す）。`stance` は原文の述べ方（`fact`＝数字や現状、`possibility`＝懸念・見込み）で、アプリの判断ではない。ファイルが無い・読めない時は節ごと出ず、アプリはそのまま動く（`loadAll` が `console.warn` を 1 回出す）。カード自身の注記の上の罫は、「有名なもの」か「公表資料」の、最後に出ている節のあとに付く（`.landmarks:not([hidden]) + .claims[hidden] + .board-already`、`.claims:not([hidden]) + .board-already`） |

計算は `boardCrossings`（`deriveTotals` の年ごとの合計を `scopeCrossings` に渡す）。県・日本は主な 8 施設だけで計算し、町は 48 種類すべて。場所か前提（`series`）が変わった時だけ作り直す。

### 町の詳細（`townPanel.css`、`townPanel.ts`・`pyramid.ts`・`seriesChart.ts`・`facilityPanel.ts`・`burdenPanel.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 見出し | `.town` `.town-head` `.town-name`（明朝 26px）`.town-sub` `.town-hint` | 町名、県と区分、何も選んでいない時のヒント |
| 節の折りたたみ（2026-11-07） | `details.panel-section.town-fold`（`.town-pyramid` `.town-series` `.town-support` `.town-facilities` `.town-burden` の 5 つ。class の 2 つ目が節の名前）`summary.town-fold-summary`（節の帯そのもの：`--accent-soft` の面に藍の 4px の左線、44px 以上、左に枠線で描く印（開くと向きが変わる）。中は節の `h3.panel-section-title`（型はそのまま、箱の余白と地は無し。見出しの階層は変わらない）と `.town-fold-gist`（ゴシック 14px `--ink-2` の要点 1 行。閉じている間だけ見え、開くと消える＝下層の閉じた行と同じ作法）。読み上げの名前は見出しと要点）`.town-fold-body`（開いた時の中身。節が持っていたものをそのまま） | 数字のタイルの後の 5 つの節は見出しの後ろに畳む。最初に開いているのは「施設の目安」だけで、年齢別の人口・人口の推移・支える人数の推移・1人あたりの歳出は閉じている（開閉は DOM の状態で、年や町を替えても変わらない）。要点：ピラミッドは表示中の年の「男 2.0万人、女 2.2万人」（`pyramidGist`。2050 年より後の印は見出しが持つ）、推移の 2 枚は「2020年7.0万人、2100年1.2万人」「2020年1.6人、2100年0.8人」に試算の印（`seriesGist`。2100 年は必ず試算）、施設は本文と同じ `summaryLine`「全48種類のうち18種類が目安を下回ります」（印は見出し）、歳出は `ownFigure` の文「この町の令和6年度：1人あたり約680千円」（実績なので印なし）。施設と歳出の `h3` は `mountFacilityPanel`・`mountBurdenPanel` の第 3 引数 `titleHost` で summary に置く。閉じた節どうしは `--sp-2` の間隔 |
| 数字のタイル | `.town-kpis`（`.kpi-row` は常に 2 列）、5 枚目 `.kpi.town-support-kpi`（2 列をまたいで 1 行を使う）と、その下の 1 行 `.note.town-support-def` | 人口・2020 年比・65 歳以上の割合・0〜14 歳の割合、5 枚目が「高齢者1人を支える現役世代」（選んだ年の 15〜64 歳 ÷ 65 歳以上、小数 1 桁、単位 人。下に「2020年は◯.◯人」。2050 年より後はその行に試算の印 `.badge-estimate`。定義の 1 行「15〜64歳の人数 ÷ 65歳以上の人数」）。65 歳以上がいなければ「—」。町・県・日本のどれでも出る（県と日本は人数を足してから割る。町の比の平均ではない） |
| 割り振りの注記 | `.note.town-alloc-note`（数字のタイルの下、読み上げ領域にしない） | 地図が表示中の年の割り振り後で、この場所が割り振りに入っている間だけ「地図は割り振り後（28.8万人）です。この欄の数字は割り振り前です。」。タイルは割り振り前のまま |
| チャートの器 | `.chart-figure` `.chart`（inline SVG、幅 100%・最大 560px）`.chart-summary` `.chart-legend` `.chart-key`（`.key-estimate` `.key-baseline`） | 図と、その下の 1 文の要約と凡例。文字はすべて `--ink-2`、系列の色で文字を塗らない |
| 推移の 2 枚 | 人口 `.town-series`（`.series-figure` `.series-svg`）、高齢者1人を支える現役世代 `.town-support`（`.support-figure` `.support-svg`） | 同じ部品（`mountSeriesChart(host, spec)`。`SeriesChartSpec` が class・題・数字の書き方・表の文言を決め、既定は人口の `POPULATION_CHART`）。支える人数の図は、2050 年までの実線も公表値ではなくこのアプリの計算した年齢別の人口から（表の下の注記がそう言う）。表を開く文言は「支える人数の推移の数字を表で見る」（390px で 1 行）、表の数字は小数 2 桁。値の無い年（65 歳以上がいない）は線を切り、点と端の数字を描かず、表と要約は「—」。属性に NaN を書かない |
| 折れ線 | `.line .line-official / .line-estimate / .line-baseline`、`.dot .dot-official / .dot-estimate / .dot-baseline`、`.chart-grid` `.chart-border` `.chart-marker` `.chart-end` `.chart-marker-label` `.chart-unit` `.chart-caption` | 公式（墨・実線）、試算（藍・破線）、参考（灰・点線）。線 2px、点 8px 以上、2050 年の縦線 |
| ピラミッド | `.pyr-m` `.pyr-f` `.pyr-hit` `.pyramid-note` | 男は `--pyramid-m`、女は `--pyramid-f`。左右と「男」「女」の文字でも区別 |
| 表の折りたたみ | `.chart-table`（`details`）、推移の表の下に `.note.chart-table-note` | 図の数字を表でも読めるように。注記は「公式推計の列は国立社会保障・人口問題研究所の発表値。このアプリは公表された仮定から公式の方法で計算し直しているので、2050 年までの地図や町の数字は発表値と、町では数人、都道府県では数十人ほど違うことがある」（全 1,884 地域・2025〜2050 年の全期間で確かめた：町は最大 8.1 人（2040 年、横浜市緑区）、県は最大 47 人（2050 年、北海道）、全国は最大 17 人。`townPanel.test.ts` が毎年検査する）（`seriesChart.ts` の `TABLE_NOTE`。数字は変えない） |
| 施設 | `.facility-summary`（明朝 20px）`.facility-notices` `.facility-group-title` `.facility-table`（`tbody th` は通常の太さ）`.facility-name` `.facility-guide` `.facility-note` `.facility-others`（`details`） | 施設の状態。印は `.tag` の 3 種 |
| 目安に届くには | `.facility-keep-row`（表の行。`data-keep-for`＝施設の id、下回らない間は `hidden`）`.facility-keep-cell`（`colspan=2`）`.facility-keep`（`details`。`summary` は他の折りたたみと同じ印、14px、44px）`.facility-keep-body` `.facility-keep-year`（`.note`。「2100年の人口で計算」に印 `.badge-estimate` か `.badge-official`、割り振りのパネルの `.alloc-year` と同じ形）`.facility-keep-needs`（`dl`。`.facility-keep-need` の `dt`「50%の目安（1,500人）まで」と `dd`「あと約360人」、目安が 1 つの施設は「目安（500人）まで」の 1 行だけ）`.facility-keep-what`（上に罫）`.facility-keep-premise` `.facility-keep-effect` `.facility-keep-top-lead` `.facility-keep-top` `.facility-keep-actions`（`.actions`。`.btn` の「地図に反映する」と `.facility-keep-status`＝`role=status`）`.facility-keep-error` `.facility-keep-limits`。施設の行（`tr[data-facility-id]`）は下回る間 `.has-keep`（下の罫を外し、2 行が 1 件に見える） | 下回る施設の下に出す折りたたみ。三大都市圏の町には出さない（表は参考として出しているだけ）。同時に開くのは 1 つ（開くと他は閉じ、町を替えても閉じる）。本体は最初に開く時に作り、あとは文字だけ書き換える（年を動かしてもボタンのフォーカスが残る）。計算は開いている間だけ。2050 年より後は「試算」の印を年の行に付ける。文言の正本は `src/ui/keepGuide.ts`（計算も：`keepNeeds`＝あと何人、`computeKeep`＝50% の目安に届く人数を `allocate` で他の町から人口に比例して移した時に、他の町がいくつ目安を下回るか、いちばん多い施設 3 つ）。ボタンは `keepOverlay()` で作った重ねを `store.set({ allocation })` に置くだけ（割り振りのパネルの状態は読まない。AI のパネルの「この割り振りを地図に反映する」と同じ作り）。置くとその施設に焦点が付く |
| 規模別の歳出（実績） | `.town-burden`（町だけ。施設の節のすぐ後で、パネルの最後）`.burden-lead` `.burden-own`（町自身の値。明朝 20px。値が無い時の文は `.is-none`＝本文の書体と大きさ）`.burden-year`（`.note`。「規模は、2100年の人口 1.2万人で選んでいます。」のあとに全角の空白と、`.badge-estimate` か `.badge-official`＝人口の印。金額には付けない）`.burden-band`（選んだ年の規模の区分の 1 文：中央値と真ん中の半数）`.burden-figure`（`figure`）`.burden-strip-title` `.burden-bars`（`ul`、`aria-label`）`.burden-bar`（`li`。3 列の grid：区分名 7.5em、棒、値 3.25em。この町の区分は `.is-current` と `aria-current`）`.burden-label` `.burden-here`（「この町の規模」。色だけに頼らず文字で印を付ける。12px、`--accent`、印の無い行は `hidden`）`.burden-track`（`aria-hidden`）`.burden-fill`（幅は行の `--burden-w`。印の無い棒は `--series-reference`、この町の棒は `--accent`）`.burden-value` `.burden-limits` `.burden-source`（どちらも `.note`）`.burden-table`（`details.chart-table`。中は `.burden-table-unit`、`.burden-band-table`、`.burden-national`、`h4.facility-group-title`＝公表値の見出し、`.burden-published-table`、`.burden-published-note`。表の行の印は `tr.is-current`） | 令和6年度の決算の実績（歳出総額 ÷ 住民基本台帳人口）を、選んだ年の人口と同じ規模の、いまの市町村と並べる。将来の予測でも、因果でもない。見出しの文は 1 人あたりを切らないよう文節に分ける（`TITLE_PARTS`）。出典・計算・団体数の文は `sourceParts`。文言の正本は `src/ui/burden.ts`（`BURDEN_TEXT`、`ownFigure`、`bandParts`、`yearParts`）、データは `public/data/finance.json`（`pipeline/build_finance.py` が作る。型と検査は `src/data/finance.ts`）。規模の区分は `src/data/finance.ts` の `bandIndexFor`（下の端を含み上の端を含まない。4,999人は最初、5,000人は 2 番目）で選ぶ。選ぶ人口は画面に出す人口と同じ数（整数に丸める）。政令指定都市の区と浜通り地域には自分の決算が無いので、「この区は政令指定都市の一部で、区ごとの決算はありません。」「この地域は複数の市町村をまとめたもので、地域としての決算はありません。」と言い、区分の比較は出す。見出しに「試算」の印は付けない（金額は実績）。表の折りたたみは DOM の状態で、年や町を替えても開閉は変わらない。表は 4 列が 390px に収まるよう、セルの左右の余白を 8px にし、「この町の規模」は行の中で改行する。「公表されている区分別の値（令和5年度）」は、年度も分け方（人口の規模でなく団体区分）も違う表として、折りたたみの中だけに出す。限りは 3 つ（同じ時点の比較で予測ではない、災害復旧や大きな事業の年は値が跳ねる、町村や特別区は都道府県が担う事務が市と違う）を欠かさず書く。「集約」「削減」「節約」「残す」「維持」などの言葉は使わない。AI の道具には繋いでいない（`burden.ts` の先頭に、`get_burden` を足す場所のコメントがある） |
| 文の折り返し | `.keep` | 数字と単位を途中で折らない |

### 前提を変える・人口の割り振り（`controlsPanel.css`、`controls.ts`・`allocationPanel.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 前提 | `.panel-lead`（2 文：2050 年までの数字は公式推計のまま動かない・ここで変えるのは 2050 年より後の前提・結果はこのアプリの試算。2026-11-07 までは 2 段落）`.controls-effect`（`div.panel-section`。導入のすぐ下＝つまみの上に置く結果：`h3.panel-section-title`「この前提での2100年」＋試算の印、`#ctl-tiles` の `.kpi-row`（日本全体と、選んだ県か町）、その下に `.note.controls-reference`＝`marksReference()`「参考：2020年は1億2,615万人（国勢調査）、2050年は1億469万人（公式推計）です。」）`.controls-groups`（`.field` を罫で区切る）`.field-tags` `.controls-actions` `.controls-status` `#ctl-error` `#ctl-infra-custom` | 導入、結果、スライダーと 2 択、戻すのボタン、状態の 1 行の順。結果はつまみを動かしながら見える位置（2026-11-07 までパネルの最後にあった） |
| 目盛りの目安（`barMarks.ts`） | `details.fold.bar-marks-fold`（各操作の直下。閉じている。`summary` は `MARKS_FOLD_SUMMARY`「ほかの値だとどうなるか」＝共通の `.fold` の行を 14px に）`.bar-marks`（その中。`id` は `ctl-cwr-marks`・`ctl-migmode-marks`・`ctl-migscale-marks`・`ctl-infra-marks`）`.bar-marks-title`（`.note` の 1 行。先頭に `.badge-estimate`「試算」）`.bar-marks-list`（`dl`。`dt` が位置、`dd` が「約6,328万人」。2 列、13px、`--ink-2`）`.bar-marks-fact`（`.note`。つまみの右端から作る 1 文） | つまみやボタンの位置ごとに、その位置にしたときの 2100 年の日本全体の人口を、各操作の直下の閉じた折りたたみに置く（2026-11-07 までは開いたまま並び、上に「どのつまみやボタンの下にも…載せています」の 1 段落があった。段落は無くし、参考の 2 点は結果の下へ）。出生率のつまみ（左端・初期値・右端）、人口の移動の 2 つのボタン、移動の強さのつまみ（左端・初期値・右端）、インフラ連動の 3 つのボタン。位置はつまみの横並びに合わせず `dl` に並べる（移動の強さは初期値がつまみの 2/3 にあり、390px では 3 つの文字が重なる）。中は読み上げ用の文字で、フォーカスを受けるのは `summary` だけ、live region でもない。各操作の `aria-describedby` に `.bar-marks` の `id` を足してあるので、閉じていても操作に入ると読み上げられる。つまみを動かしても変わらない（つまみの位置ではなく、つまみそのものの説明）。数字は `barMarks.ts` に定数で持ち、`barMarks.test.ts` が実データ（1,884 地域・48 施設）でエンジンを走らせて全部を照合する（上限・初期値・プリセットの強さ・エンジンのどれが変わっても落ちる）。「日本全体」は全地域に同じ前提を当てた合計（つまみは選んだ場所だけでなく全国に効く）。つまみの 1 文は数字から作り（右端が 2050 年に届くか届かないかは `reachSentence` が人数で比べる）、固定の文にしない。インフラ連動は「仮定どおりに計算した」と書き、測った効果とは書かない（既存の注意書きはその下にそのまま残す） |
| 割り振りの入力 | `.alloc-form` `.alloc-regions`（`fieldset`）`.alloc-region`（チェックボックス 20px、行 40px）`.alloc-year` | 対象・割合・引く元 |
| 地図への反映 | `.alloc-map-actions` `.alloc-map-toggle`（`aria-pressed`。「地図に反映する」/「地図に反映中」）`.alloc-map-status`（`role=status`） | 押すと store の `allocation` に今の結果を置く。年・前提・入力が変わるたびに置き直す。外す・片付けると消す。反映中は地図で別の県や町を選んでも対象を変えない（印をたどってほかの県の輪を見るため）。反映していない時は、これまでどおり地図の選択が対象になる |
| 結果 | `.alloc-result` `.alloc-summary`（role なし。年を動かすたびに書き換わる）`#alloc-announce`（`.sr-only`、`role=status`。割り振りの入力を変えた時だけ、1 回書く。年は含めない。地図が対象を動かした時は空にする）`.alloc-notes`（表の下の注記：`p.note` の 2 行「人口の差は全国で見ると小さいので、人口の目安をまたぐ町の数で示しています。」「実際の人口の動きの見通しではなく、「もし割り振ったら」の計算です。」と、閉じた `details.fold.alloc-terms`（`summary` は `TERMS_SUMMARY`「用語の説明」。中に「人口の目安」の定義と三大都市圏の数え方の 2 段落。文言は 2026-11-07 までの 4 段落のまま、分けただけ））`.alloc-more`（`details.fold`。`summary` は `MORE_SUMMARY`「ほかの施設を見る（N件）」） | 1 文の要約と施設の表。読み上げるのは入力を変えた時だけで、年のコマ送りでは読み上げない |
| 施設の表 | `.alloc-table-visible`（最初に見せるのは「くらしの基本の施設」の全行と、「その他の施設」のうち目安をまたいだ町が多い上位 3 件＝`VISIBLE_OTHER_CAP`。2026-11-07 までは合わせて 10 行）`.alloc-table-hidden`（残りは `.alloc-more` の中）`.alloc-group`（`th[scope=rowgroup]`）`.alloc-name.alloc-focus`（施設名のボタン：藍の下線付きの文字で 40px、押した状態は `--accent-soft` の面。`aria-pressed`、`data-facility`。押した状態はその場で書き換え、表を作り直さない：フォーカスも開いた「その他の施設」もそのまま。年や前提を変えて表を作り直した時は、同じ施設のボタン（`data-facility`）へフォーカスを戻し（画面は動かさない）、その施設が無ければ表の見出しへ）`.alloc-example` `.alloc-example-count` `.alloc-down`（減る差は `--decline-deep`） | 施設名を押すと、その施設の目安をまたいだ町に地図で印が付く |

### AI に質問（`aiPanel.css`、`aiPanel.ts`・`aiTrace.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 入力 | `.ai-panel` `.ai-samples` `.ai-sample`（幅いっぱい・左揃え）`.ai-form` `.ai-input` `.ai-help` `.ai-counter`（`.is-over`）`.ai-input-msg` `.ai-new`（`.is-attention` は藍の 2px 枠） | 例の質問、自由入力、新しい質問。冒頭の説明 `.panel-lead` は、ビルドが AI の接続先（`VITE_CHAT_ENDPOINT`）も `endpoint` も決めていない時は、答えるという約束ではなく、接続先が無い時の札と同じ 1 文（「このバージョンでは、AIへの質問は使えません…」）。決めた時は「日本語で質問すると…」。例の質問のボタンはどちらでも付く。接続先が無いのに AI が答えた時は、最初の本物の答えのあとで後者に替わる |
| 待ち | `.ai-status` `.ai-status-text`（`role=status`）`.ai-cancel` | 1 行と「やめる」 |
| 答え | `.ai-answers` `.ai-answer`（罫で区切る。`[data-role=ai-unavailable]` は AI の接続先が無い時の 1 文で、画面に 1 つだけ。ボタンは無いが、保存済みの答えが確認済みの質問がある間は、その質問のボタン `.ai-fail-samples` が付く）`.ai-question` `.ai-answer-head` `.ai-answer-text` `.ai-basis`（数字の確認を通った答えにだけ）`.ai-estimate`（確認できなかった数字のある答えと、2051 年以降の結果を持つ失敗の札に付く「2050年より後は、このアプリの試算です」の 1 行。答えの文が 2051 年以降の年を言う時も、札の上の印 `.badge-estimate` を出す）`.ai-message` `.ai-trimmed` `.ai-fail` `.ai-fail-samples`（保存済みの答えが確認済みの質問がある時だけ） | 新しい順。保存済みは `.tag`、試算は `.badge-estimate` |
| 確かめられない数字 | `.notice.ai-warning`（墨の 4px の左罫） | 赤錆は使わない（目安を下回る印に取ってある） |
| 使った道具 | `.ai-trace`（`details`）`.ai-trace-list` `.ai-trace-item` `.ai-trace-name` `.ai-trace-label` `.ai-trace-input` `.ai-trace-result`（`details`）`.ai-json`（`pre`、paper-2 の面）`.ai-copy-status` | 入力と結果をそのまま見せる |
| 地図・前提・割り振りへの橋 | `.ai-links`（「◯◯を地図で開く」）`.ai-scenarios` `.ai-scenario` `.ai-scenario-msg`（`data-role=apply-scenario`）`.ai-allocations`（`data-role=apply-allocation`、「この割り振りを地図に反映する」） | 道具の入力から計算し直して store に置く。モデルの文章は何も使わない |

## 帯・下層への入口・閉じたカード（`app.css`・`theme.css`、`app.ts` の `headerHtml`・`moreHtml`・`panelHtml`、文言は `sources.ts` の `NAV_*`）

| 要素 | class | 役割 |
|---|---|---|
| 帯 | `.app-head`（`--band` の地。中は `.app-head-inner`、`--page` 幅）`.app-title` `.app-problem` | 題と問いだけ。説明の 1 行（`APP_LEAD`）は出典のカードの先頭 `.app-foot-lead` に移した（2026-11-06） |
| 下層（くわしく見る） | `.app-more`（`section`、`aria-labelledby`。右の列の、分かれ目の次）`.app-more-title`（`h2`「くわしく見る」、ゴシック 15px `--ink-2`）`.app-more-list`（縦に積む grid。中は閉じたカード 5 枚そのもの。最後は出典 `footer.app-foot.panel#panel-sources`）`.app-more-desc`（`.sr-only`。各カードの直前に置く 1 行の説明 `NAV_DESCRIPTIONS`。カードの外に置くので、カードの名前にも中身にも混ざらない） | 町の詳細・前提を変える・人口の割り振り・AIに質問・出典の 5 つが、見出しの下に縦に並ぶ。入口は 1 つ（2026-11-06 の「名前のボタンの行＋濃い帯」の二重表示を、2026-11-07 に本人指示で 1 つにした）。貼り付く帯も横に動く帯も無い |
| 閉じたカード＝軽い行 | `.panel.is-collapsed`（`theme.css`：`> :not(.panel-title)` を `display:none`、下の余白 0、地と枠を消して上に `--line-2` の罫 1 本（最後の行は下にも）。中身は DOM に残る）`.panel-toggle`（`h2.panel-title` の中の `button`、`aria-expanded`、`aria-describedby`＝`.app-more-desc`。閉じている間は 44px・列の端いっぱい・墨の文字、左に枠線で描く印（開くと向きが変わる）。中は `.panel-toggle-name`（明朝 18px、ボタンの名前）と `.panel-toggle-line`（ゴシック 14px `--ink-2`、`aria-hidden`。`NAV_SUMMARIES` の短い説明。入りきらなければ名前の下に折れる。開くと消える）。焦点の輪は藍の `--focus-ring` を行の内側に）。試算の印は閉じている間は普通の破線の印、開くと帯の中で明るい色 | 最初は全部閉じている。閉じた行の見出しを押すと、開いて（`is-collapsed` を外し `aria-expanded=true`）、`scrollIntoView`（動きを減らす設定なら即時）でその欄を窓の上へ（住所の # は変えない）、焦点はそのボタンのまま（`goToPanel`）。開いたカードの見出しを押すと、その場で閉じる（動かない）。開いたカードは上下に `--sp-3` の余白（隣の行の罫と枠が重ならない）。分かれ目と町の数字のカードにはボタンが無く、常に開いている |

読み込み中と読み込み失敗の画面にも帯は出す（データが届くとき、帯が動かない）。説明は欄の内側が言っていること（人口の割り振りなら「全国の人口は変えずに」）と合わせ、何を残すかの助言や「残せない」の断定は書かない（`sources.test.ts` が語を検査する）。

### 町の数字（`placeFacts.css`、`placeFacts.ts`）

`#panel-facts`（`section.panel.place-facts`。町を選んでいる時だけ出し、県と日本では `hidden`）。見出しの帯は町の名前 `.place-facts-name` と年の印（`.badge-estimate` か `.badge-official`）。中は `dl.place-facts-list`＝2 列 × 2 行の格子で、4 枚のタイル `.place-fact`（`dt` が「2050年の人口」「2020年比」「65歳以上の割合」「高齢者1人を支える現役世代」＝13px の `--muted`、その下に `dd`＝明朝 26px の数字。単位は `.place-fact-unit`＝ゴシック 14px `--ink-2` で、`dd` の文字は「4.2万人」のまま。見出しが 2 行に折れても数字はタイルの下端にそろう）。一覧は自分の余白を持たず、カードの内側の余白（`.panel > *` の `margin-inline`）で縁から離す（2026-11-07 まで `margin: 0` がこの余白を打ち消し、縦 4 行が縁に付いていた。同日に 2 行 2 列へ）。数字は町の詳細の最初の 4 枚のタイルと同じ関数（`deriveTotals`・`ageShares`・`deriveSupport`）と同じ書き方（単位の分け方も `splitUnit`）で、`placeFacts.test.ts` が 3 町 × 3 年でタイルと照合する。

## 地図（`app.css`、`src/map/`）

| 要素 | class | 役割 |
|---|---|---|
| 面 | `.area`（fill を書き換えるだけで DOM は作り直さない）`.mesh`（紙色の境界）`.coast` | 2020 年比、または割り振りの変化 |
| 輪 | `.ring-hover`（墨 1.5）`.ring-selected`（墨 2.25）`.ring-focus`（藍 2.5）`.ring-gain`（青 2.25・実線＝人口の目安を下回らなくなった町）`.ring-loss`（赤錆 2.25・破線＝人口の目安を下回った町）。どれも紙色の halo 付き。gain・loss の halo（`.ring-gain-halo` `.ring-loss-halo`）は 7.5 と太い：その町は割り振りの対象で、輪と同じ色相の濃い面の中にあることが多いので、紙色の帯で輪を浮かせる | 重ねて描くので隣の面に隠れない |
| 印 | `.markers`（`aria-hidden`。数は面の `aria-label` とツールチップにある）`.marker`（`.marker-gain` `.marker-loss` `.marker-mixed`、`data-for`＝県コード）`.marker-dot` | 全国の地図で、焦点の施設について県ごとに目安をまたいだ町の数。県の中心に墨の点、その少し上に紙色の下地と 12px 太字の「+n −n」（小さい県の色を隠さない）。大きさは `choropleth.ts` 先頭の `MARKER_*` 定数（画面の px）で、地図の縮尺の逆数を掛けて、スマホ幅でも同じ大きさに保つ |
| 離島 | `.map-inset` `.inset-bg` `.inset-frame` `.inset-label` `.hit` | 遠い島は別の縮尺の枠に |
| 割り振りの行 | `.alloc-bar`（「地図に反映中の割り振り：」）`.alloc-bar-name`（「和歌山県 +10%」）`.alloc-bar-stale`（「この割り振りは◯年の計算です」）`.alloc-clear`（「割り振りを地図から消す」、40px。Esc でも消える：つまみ・チェックボックス・ボタンに焦点がある時も。文字を打つ欄（検索・質問の入力・選択欄・編集できる領域）の中の Esc は欄のもの、開いた dialog がある間と、ほかが処理した Esc も消さない） | 地図の上、見出しの下。消えた時にこの行にフォーカスがあれば、見出しの地名へ移す |
| 地図の最初の跳び先 | `.skip-link`（`.map-stage` の最初の子。「地図をとばして、年の選択へ」。焦点が無い間は画面の外、焦点が来ると地図の左上に藍の枠のボタンとして出る（配置は変わらない）。押すと年のつまみに焦点を移す） | 地図の Tab 停止を飛ばす |
| 地図の色 | `.map-mode`（地図のすぐ下、凡例の塊 `.legend-block` の最初の行。`.map-mode-label`「色の見方」（14px `--ink-2`。`role=group` の `aria-labelledby` の先）と、共通の `.choice` の箱を外した軽い 2 択：文字だけ 14px `--ink-2`、選んだ方は `--ink` の太字に 2px の下線、各 44px、`aria-pressed`。「人口の変化」（既定）「高齢者1人を支える人数」。2026-11-07 までは地図の上の黒い塗りの分割ボタンだった） | 押すと store の `mapMode` を置く。割り振りを地図に反映している間は隠す（割り振りの色が優先。隠す時にこのボタンにフォーカスがあれば見出しの地名へ移す）。割り振りを消すと、選んでいた色に戻る。「高齢者1人を支える人数」の間は、場所の数字が「2050年 高齢者1人を支える現役世代 1.4人　2020年は2.1人」と年の印（日本の地図では全国の値）、ツールチップと面の `aria-label` も同じ値（2050 年より後は試算の印、読み上げは「（このアプリの試算）」）、場所の読み上げも比になる |
| 凡例 | `.legend-block`（地図のすぐ下の塊。中は `.map-mode`（上の行）と `.legend`。1024px 以上は上に `--line` の罫）`.legend`（`data-mode="ratio" | "support" | "allocation"`）`.legend-title` `.legend-bar` `.legend-ticks` `.legend-tick` | 説明文 `.legend-title` は色の切り替えのすぐ下、墨で 15px（1024px 以上は 14px。2 つの色の向きが逆なので、読める大きさで置く）。2020 年比は「色は2020年の人口に対して、どれだけ残るか（薄いほど少ない）」（1280px 以上で 1 行。1024〜1279px は 2 行）、9 段の帯（段の境目ははっきり）、目盛は 1 段 3 か所「16分の1以下」（左端）「半分」（5/9 の段の境目）「同じ以上」（右端＝2020 年と同じ段と増えた段）。2026-11-07 までは 2 段 5 か所（「4分の1」「同じ」「増えた所は一番濃い」も）だった。割り振り中は「割り振りによる人口の変化（%）」に切り替わる。支える人数の間は「色は高齢者1人を支える人数（黒に近いほど少なく、大変）」、6 段の帯（左が黒に近い）、境目ごとに「0.8人」「1人」「1.5人」「2人」「3人」の目盛（端に寄せる目盛は無い）、読み上げは「左から 0.8人未満、0.8〜1人、1〜1.5人、1.5〜2人、2〜3人、3人以上」。目盛の箱の高さはどの凡例でも同じ（切り替えても年のつまみが動かない） |

キーボード：地図は Tab 停止が 1 つだけ（`tabindex` が 0 の地域は選択中の地域、無ければ最初の地域。ほかは -1）。地図の中は矢印キーで、その向きにある中心点のいちばん近い地域へ移る（`src/map/keyboard.ts` の `nearestInDirection`：その向きに厳密にある地域だけ、横のずれは 2 倍に数える、同点は Tab 順で先のもの、端では動かない）。PageUp・PageDown は Tab 順の前と次の地域（端で止まり、回り込まない）で、矢印のどれからも最寄りにならない地域（北海道の地図の札幌市南区）にも届く。Home・End は Tab 順の最初と最後。Enter・Space は選ぶ。矢印は離島の枠（沖縄県・遠い島々）と本体の間を跨がない（北海道から上に押して沖縄県に着かない）：本体からは枠の地域に着かず、枠の地域からは枠の中だけを動く。枠の地域は PageUp・PageDown・Home・End と検索で着く。Alt・Ctrl・Cmd・Shift つきのキーはブラウザに任せる。焦点を持った地域が Tab 停止になる（選択が変わった時だけ選択中の地域に戻す）。町は検索欄からも選べる。

目印だけの class（css の規則が無く、テストやスクリプトが要素を探すためのもの）：`.ai-allocations` `.ai-basis` `.ai-cancel` `.ai-form` `.ai-links` `.ai-message` `.ai-trace` `.ai-trace-result` `.ai-trimmed` `.alloc-clear` `.alloc-map-actions` `.alloc-map-status` `.alloc-map-toggle` `.alloc-table-hidden` `.alloc-table-visible` `.head-basis` `.map-inset`。見た目は一緒に付く共通の class（`.btn`・`.note`・`.data-table` など）が決める。`.marker-mixed`（増えた町と減った町の両方がある県）は独自の色を持たず、印の文字は墨のまま。

## 数字と文言

- 人口は `formatPop()`（`src/ui/format.ts`）：8,340人 / 4.2万人 / 1,190万人 / 1億2,615万人。高齢者1人を支える人数は `formatSupport()`：2.1人 / 0.8人（小数 1 桁）、表は `formatSupportExact()`：2.08（小数 2 桁、単位は列名に）。比が出せない時は「—」（Infinity や NaN を出さない）。比に良い・悪いを付けない。増減は `formatPct()`：−31.5% / +2.5%（マイナスは U+2212）。割り振りの変化は `formatDeltaPct()`：+10.0% / −0.04% / ±0%。
- 割り振りが地図にある間、見出し・ツールチップ・面の `aria-label`・場所の読み上げは、割り振りの年と表示中の年が同じなら割り振り後の人口と 2020 年比を出し、割り振り前の人口も並べ（「28.8万人（割り振り前 26.2万人）」）、「割り振り後」の印（読み上げは「（割り振り後）」）を付ける。解釈：2050 年より後は「試算」を必ず出す、という全体の決まりのため、「割り振り後」の印は「試算」の後ろに足す（置き換えない）。2050 年まで（2020 年を含む）は、割り振り後の数字はもう公式推計（2020 年は国勢調査）の値ではないので、見出しは（その場所の数字が割り振りで実際に変わる時だけ：全国の合計は変わらないので、全国と、変化が 0 の場所では元の印のまま。`figureChanged()`）「公式推計」「実績（国勢調査）」の印を外し、「割り振り後」の印に「公式推計をもとにこのアプリが計算」（2020 年は「国勢調査をもとにこのアプリが計算」）を添える（`allocatedBasisNote()`、`.head-basis`）。ツールチップにはもともと「公式推計」の印が無い。年が違えば数字はそのまま、印も付けない。ツールチップと `aria-label` には「割り振りによる変化 +10.0%」（年が違えば「（2100年の計算）」を添える）と、焦点の施設があれば「◯◯が人口の目安を下回らなくなる」「◯◯が人口の目安を下回る」、全国の地図では「◯◯：人口の目安を下回らなくなる町 +n、下回る町 −n」を足す（町が無い側は書かない：「人口の目安を下回らなくなる町 +1」だけ、「人口の目安を下回る町 −2」だけ。言葉は町の詳細の施設の状態と同じ：「人口の目安を下回る」は `facilityStatus` が 'below'（人口 < 50% の値）、増えた町はもう下回らない（境目か上回る）。「目安以上」は使わない（「目安」が 50% の値と 50〜80% の幅の 2 つの意味になるため）。「−0」「+0」は出さない）。県の変化は `allocatedTotals()`（`src/ui/derive.ts`）で県の合計から計算する。これらの数字と文言は `src/ui/allocationView.ts`（DOM なしの関数：`allocationView`・`placeNumbers`・`allocationLines`・`countMarkers`）にあり、シェルと町の詳細の注記が同じものを使う。
- 色の幅（`allocationScale`）は最大の変化を画面と同じ小数 1 桁に丸めてから 5・10・20・30・50・100 と比べる。計算の誤差（10.000000000000018）や人数の丸め（10.0001）で +10% の割り振りが ±20 にならない。
- 2050 年より後の数字には必ず試算の印を付け、「予測」と書かない。文言の正本は `src/ui/sources.ts`（`ESTIMATE_NOTE`・`OFFICIAL_NOTE`・`badgeFor`・出典）。年のつまみの下の注記（`.year-note`。つまみの下に 1 行、年の塊の幅いっぱい。1024px 以上は 13px）は 2050 年までが `OFFICIAL_NOTE`「2050年まで公式推計（国立社会保障・人口問題研究所）」（略称を使わず 1 行。2026-11-07 までは「2050年までは国立社会保障・人口問題研究所の公式推計」で 2 行だった）、2050 年より後は試算の印と `ESTIMATE_NOTE`「2050年より後は、このアプリの試算です（予測ではありません）」。「社人研」とは書かない。
- 出典（フッター）は `SOURCES`（`src/ui/sources.ts`）が正本。どの出典も、加工して作成したと書き、出典のページの URL を「文字が URL そのもののリンク」（`target=_blank` `rel=noopener`）で見せ、取得日（`docs/sources.md` の日付）を添える。測量法の承認の行は境界の出典の最後に残す。1 件は「何か」「ページと取得日」「承認の行」を `.src-text` `.src-where` `.src-approval` の 3 段に積む（スマホ幅でも読め、URL は途中で折れる）。人口の出典は「国立社会保障・人口問題研究所がこのアプリの内容を保証するものではありません」で終える（`docs/sources.md` と README のとおり）。長い句は `word-break: auto-phrase`（Chromium）で文節で折る。
- 施設の名前は 1 つだけ：`public/data/facilities.json` の `name` を、施設の `id` で引いて出す（町の詳細の表・割り振りの表・ボタンの読み上げ・ツールチップと地図の読み上げ・割り振りの `flips`）。UI のコードに施設の名前を直接書かない（`facilityNames.test.ts` が検査する）。README や docs の言い換え（「飲食料品店」「診療所」など）は画面の名前ではない。
- 見出しの下の問い `.app-problem`（`header.app-head` の 3 つ目、`APP_PROBLEM`＝`src/ui/sources.ts` が文言の正本）：「いま、何を残したいかを決めておかなければ、あとから選べなくなるかもしれません。わたしたちは何を残すのか。2100年の数字から考えます。」（2026-11-06 に本人が選んだ文）。題と説明の下に 1 行を専有（`flex: 1 0 100%`）、本文の墨（`--ink`）、15px、文節ごとの `.keep`（`phraseHtml`）。1024px 以上は 1 行（約 930px）、それより狭い画面は 44em で折り返す（390px で 4 行）。問いかけで、残す・残さないを勧めず、「残せない」とも書かない。一人称は「わたしたち」（漢字の「私」は使わない）。読み込み中・失敗の画面も同じ見出しを使う。
- 「残せない」でなく「人口の目安を下回る」。残す・残さないを勧める言葉は書かない。
- 「この目安に届くには」の文言：人数は「もし移ったら」の仮の数で、実際の人の動きの予測ではない。人口の目安は 2009〜2012 年の統計で、人口が増えれば施設ができるという因果を示さない（`KEEP_LIMITS`、1 文）。結果は事実だけ（「ほかの19町が、いずれかの施設の人口の目安を下回ります」）で、残す・残さないも、人を動かすべきかどうかも書かない。動かす人数が他の地域の人口を超える（`allocate` が RangeError）時は「人数が大きすぎて、この計算はできません。」だけを出す。
- 「いま、この規模の市町村は、1人あたりこれだけ使っています」の文言：金額は令和6年度の決算の実績で、2050年より後を選んでも「試算」は人口（規模を選ぶ数）にだけ付ける。「この町は費用がかかりすぎる」「集約すれば減る」「残すべき」のような価値の判断・因果・勧めは書かない。町自身の値が無い場所（政令指定都市の区、浜通り地域）は、無い理由を 1 文で言う。
- 丸数字・矢印記号・英語の大文字ラベルは使わない。

## チャート（推移・ピラミッド）

- インライン SVG。軸と目盛線は `--grid`、文字は `--ink-2`（系列の色で文字を塗らない）。線は 2px、点は 8px 以上。
- 推移は 1 軸。公式（墨・実線）、試算（藍・破線）、参考（灰・点線）の 3 本まで。人口と高齢者1人を支える人数は別々の図（2 つの軸を 1 枚に重ねない）。凡例は必ず置き、2050 年の縦線で公式と試算の境を示す。選んだ年のラベルは、その年が横軸の目盛（2020・2040・2060・2080・2100）と重なる時は出さない（同じ「2100年」を 2 回印字しない）。
- ピラミッドは男 `--pyramid-m`、女 `--pyramid-f` を左右に。年齢の階級は 5 歳ごと 20 区分。
- SVG の中の生の数値（幅・行の高さ・余白）は、ファイルの先頭の名前付き定数（`W`・`ROW`・`BAR`・`TOP`・`RIGHT` など）にだけ書く。描画の式に数字を直に書かない。色は css の class で付け、属性に色を書かない。
- 地図の色と同じ意味で赤錆を使うのは「目安を下回る」の時だけ。

## 状態と更新

- 状態は `store`（`src/ui/state.ts` の `createAppStore`）。`store.get()` で `year`・`scenario`・`series`・`selectedPref`・`selectedArea`・`allocation`・`mapMode` を読み、`store.subscribe((s, prev) => …)` で描き直す。`store.set(patch)` は適用されたら `true`、何も変わらない・拒否されたら `false` を返す。`prev` はその購読者が前に受け取った状態。購読者の中で `set` してよい（割り振りのパネルは年の変化を受けてその場で置き直す）：その時は全員に新しい状態がすぐ届き、まだ受け取っていない購読者にはいくつかの変化が 1 回にまとまって届く（打ち消し合って何も変わらなければ呼ばれない）。古い状態で終わる購読者は出ない。通知の途中で購読をやめた購読者には、その通知はもう届かない。
- 町を選ぶ時は `store.set({ selectedArea: code })` だけでよい。store が `selectedPref` をその町の県にそろえる（県の地図・パンくず・戻るボタンも付いてくる）。`store.set({ selectedPref })` で県を変えると、その県に属さない町の選択は消える。`selectedPref: undefined` で日本に戻る（町の選択も消える）。無い地域コード・県コードは拒否される（状態は変わらず、通知も無く、console.warn が出る）。`src/ui/nav.ts` の `pickArea`・`pickPref`・`goUp`・`toJapan` は同じ patch を作る便利関数。
- `store.set({ scenario })` を呼ぶと、`series` が同じ通知の中で更新されて届く（自分で runner を呼ばない）。範囲外・NaN・未知の migMode は拒否され、前の値が残る（通知なし・console.warn）。値が同じ scenario を入れ直しても通知は無い。スライダーの min/max は `SCENARIO_LIMITS`（`src/data/runner.ts`）に合わせる。
- `year` は 2020〜2100 の 5 年刻みだけ受け付ける（それ以外は拒否）。
- `mapMode` は地図の色：`'change'`（2020 年比、既定）か `'support'`（高齢者1人を支える人数）だけ受け付ける（それ以外は拒否、console.warn）。年・前提・割り振りが変わっても残る。割り振りが地図にある間は割り振りの色が優先し、消えると戻る。
- 支える人数は `deriveSupport(series, data.groups)`（`src/ui/derive.ts`）：地域・県・全国の年ごとの比（`deriveTotals` と同じ形、`series` ごとに 1 回）。計算そのものは `src/engine/aggregate.ts` の `supportRatio`・`supportRatioOf`（15〜64 歳＝階級 3〜12、65 歳以上＝階級 13 から。65 歳以上が 0 なら NaN）。文言は `src/ui/support.ts`。
- `store.set({ allocation })` で割り振りを地図に置く（`AllocationOverlay`：`year`・`label`・`changePercent`（地域コードごとの % 変化）・`flips`（施設ごとの人口の目安を下回らなくなった町・下回った町の全コード）・`focusFacilityId`）。store が検査して写しを持つ（無いコード・NaN・刻み外の年・flips に無い focus は拒否）。`store.set({ allocation: undefined })` で消える。前提（scenario）が変わると自動で消える（割り振りのパネルは反映中なら計算し直して置き直す）。年が変わっても消えず、地図の上に「この割り振りは◯年の計算です」と出る。作るのは `buildOverlay()`（`src/ui/allocationOverlay.ts`）、AI の道具の入力からは `overlayFromToolInput()`（道具と同じ読み方：年は 5 年刻みに切り下げ、人数は整数に丸め、前提は `sanitizeScenario`。読めない入力は日本語の文で断る。モデルの書いたコードは 12 文字までにして文字として出す）。AI のパネルがボタンを出すのは、結果が error でなかった `run_allocation` の入力だけ（同じ入力は 1 つ、3 つまで。`allocationOffers()`）。押すと年をその割り振りの年に動かし、前提が画面と違えば前提も同じ patch で置く（目安をまたぐ町は前提で変わるため）。前提が違う間はボタンに「（前提も画面に合わせます）」と添え（画面の前提が変わるたびに付け外しする）、押した後は「この割り振りの前提も画面に反映しました（…）」と伝える。共通の計算（`populationAt`・`targetPeople`・`allocationErrorMessage`）は `src/ui/allocationCore.ts` にあり、パネルと `allocationOverlay.ts` の両方がそこから読む（互いを読み合わない）。
- 年ごとの合計は `deriveTotals(series, data.groups)`（`src/ui/derive.ts`）。`series` が同じ間は同じ結果が返るので、呼ぶたびに計算し直さない。
- 描き直しは変わった所だけ。DOM を作り直さず、文字と属性を更新する。読み上げの領域（`role=status`・`aria-live`）は意味が変わった時だけ書き換える。

## 確認（納める前）

- `npm run typecheck && npx vitest run && npm run build`。
- Playwright で 390px を先に、次に新しいタブで PC 幅（追従）。横スクロールが無いこと、文字が 4.5:1 以上、面の色が 3:1 以上、触れる所が 40px 以上。
- 試算の印が 2050 年より後に出ること、「予測」の語が無いこと。
