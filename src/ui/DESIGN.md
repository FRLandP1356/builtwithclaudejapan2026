# 画面の設計（Task 8 で決めた正本。パネル（Task 9・10・13）はこれに従い、足した部品もここに載せる）

このアプリの見た目は 1 回だけ決める（Ruling 23）。トークンは `src/ui/theme.css`、骨組みは `src/ui/app.css`、パネルの配置の糊は各パネルの css（`townPanel.css`・`controlsPanel.css`・`aiPanel.css`）。ここにある部品だけを組み合わせ、新しい色・書体・影・角丸を発明しない。

## 方向

- 題材は「2100年の日本」の人口。市民・自治体職員・審査員が読む、落ち着いた公的データの刊行物の調子。
- 紙色の地、墨の文字、藍のアクセント 1 色。地図の赤錆（減少）と青（増加）はデータの色で、UI の装飾には使わない。
- 見出しと大きな数字は明朝、それ以外はゴシック。等幅は使わない。英語の大文字の小見出し、カード型の影の連なり、グラデーションの帯は使わない。
- 目立たせるのは地図と年のつまみだけ。年を動かすと地図の色が 2020 年比で移ろう、これが記憶に残る瞬間。ほかは静かに。
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
| 地図の中立（2020 年と同じ・割り振りで変化 0） | `--map-neutral` | `#d0c9c4` |
| 地図の「高齢者1人を支える人数」の 6 段（薄い → 濃い） | `--support-1` … `--support-6` | `#a0afc3` `#889ab5` `#7086a8` `#58739a` `#415f8c` `#2b4c7e`。`--accent` を `--paper` に OKLab で 40・52・64・76・88・100 % 混ぜた色（新しい色相は足さない）。隣り合う段は OKLab の明度で 0.066 ずつ（WCAG のコントラスト 1.28〜1.34）、いちばん薄い段も紙に対して 2.04:1（海や空の地域に見えない）、いちばん濃い段は `--accent` そのもの。正本は `src/map/colors.ts` の `SUPPORT_COLORS`（`colors.test.ts` が混ぜ方・段差・theme.css との一致を検査する） |
| 折れ線：公式 / 試算 / 参考 | `--series-official` / `--series-estimate` / `--series-reference` | 墨の実線 / 藍の破線 / `#8a8378` の点線 |
| 人口ピラミッド：男 / 女 | `--pyramid-m` / `--pyramid-f` | `#2b4c7e`（紙に 7.9:1）/ `#6085b9`（紙に 3.5:1、paper-2 に 3.2:1。男女は左右と「男」「女」の文字でも区別） |
| チャートの目盛線 | `--grid` | `--line` と同じ |
| 書体 | `--font-display` / `--font-body` | 明朝（Hiragino Mincho ProN, Yu Mincho）/ ゴシック（Hiragino Sans, Yu Gothic） |
| 文字の大きさ | `--fs-12` … `--fs-56` | 12 は注記だけ。本文 16、パネル見出し 20、大きな数字 28、年 44 |
| 余白 | `--sp-1` … `--sp-8` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| 角丸・影・フォーカス | `--radius` 4px、`--shadow` 1 段、`--focus-ring` 2px の藍 | 影はツールチップと検索候補だけ |
| 触れる大きさ | `--touch` | 44px |

地図の色の計算は `src/map/colors.ts`。2020 年比は `changeColor(ratio)`（対数、1 … 1/16 が赤錆、1 … 1.5 が青、範囲外は端に丸める）。割り振りの変化は `allocationColor(percent, scale)`（0 を中心に ±scale %、同じ 2 本の腕を使う。scale は `allocationScale()` が最大の変化から 5・10・20・30・50・100 に丸める）。高齢者1人を支える人数（15〜64 歳 ÷ 65 歳以上）は `supportColor(ratio)`：区切り 0.8・1・1.5・2・3 の 6 段（`SUPPORT_BREAKS`。全 1,884 地域の 2020 年と 2100 年の分布から決めた。根拠の数字は `colors.ts` の注記）、濃いほど人数が多い。段は画面に出す小数 1 桁の値で決める（「1.0人」と出る町は「1〜1.5」の段）。65 歳以上がいない地域（実データには無い）は `--map-neutral` の灰色。良い・悪いの色にはしない（赤錆や青は使わない）。

## 配置（slots）

- 390px：1 列。上から 見出し → 場所の行（パンくず・戻る・検索）→ 場所の数字 →（割り振り中は 割り振りの行、それ以外は 地図の色の 2 択）→ 地図 → 凡例 → 年 → `#panel-town` → `#panel-controls` → `#panel-allocation` → `#panel-ai` → 出典。
- 1024px 以上：2 列（地図 3 : パネル 2）。左の地図の列は `position: sticky` で、地図・凡例・年が 1 画面に収まる（地図の高さは `calc(100vh - 422px)` まで。422px は見出し・場所の行・場所の数字・地図の色の 2 択（または割り振りの行）・凡例・年の分。`appCss.test.ts` が検査する）。右の列にパネルが縦に並ぶ。
- パネルは `(el: HTMLElement, ctx: PanelContext)` で `el`（既にある `<section class="panel" id="panel-…">`）の中身を置き換え、片付けの関数を返す。`el` 自体の class と id は変えない。見出しは `h2.panel-title` を 1 つ残す（試算の印は `h2` の中に足す）。
- 取り付けは `src/ui/app.ts` の `mountPanels(ctx, slots)`（「Panel registry」の印の付いた 4 行。返った片付けの関数は `destroy()` が呼ぶ）。
- 横スクロールを出さない。横長の表は `.table-wrap` に入れる。

## 共通の部品（`theme.css`）

| 用途 | 書き方 |
|---|---|
| パネルの見出し | `<h2 class="panel-title">町の詳細 <span class="badge-estimate">試算</span></h2>`（試算の印は 2050 年より後の数字を含む時だけ） |
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
| 折りたたみ | `<details class="…"><summary>その他の施設を見る</summary>…</details>`。`summary` は 40px 以上・藍の文字。矢印の記号は書かず、`::before` の枠線で印を描く（`townPanel.css` の `.chart-table` / `.facility-others`） |
| 読み込み中 | `<div class="skeleton" style="height:120px"></div>` |
| 画面の外に出す文字（読み上げ用） | `.sr-only` |

## パネルが足した部品の族（各パネルの css。値は全部トークン）

### 町の詳細（`townPanel.css`、`townPanel.ts`・`pyramid.ts`・`seriesChart.ts`・`facilityPanel.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 見出し | `.town` `.town-head` `.town-name`（明朝 26px）`.town-sub` `.town-hint` | 町名、県と区分、何も選んでいない時のヒント |
| 数字のタイル | `.town-kpis`（`.kpi-row` は常に 2 列）、5 枚目 `.kpi.town-support-kpi`（2 列をまたいで 1 行を使う）と、その下の 1 行 `.note.town-support-def` | 人口・2020 年比・65 歳以上の割合・0〜14 歳の割合、5 枚目が「高齢者1人を支える現役世代」（選んだ年の 15〜64 歳 ÷ 65 歳以上、小数 1 桁、単位 人。下に「2020年は◯.◯人」。2050 年より後はその行に試算の印 `.badge-estimate`。定義の 1 行「15〜64歳の人数 ÷ 65歳以上の人数」）。65 歳以上がいなければ「—」。町・県・日本のどれでも出る（県と日本は人数を足してから割る。町の比の平均ではない） |
| 割り振りの注記 | `.note.town-alloc-note`（数字のタイルの下、読み上げ領域にしない） | 地図が表示中の年の割り振り後で、この場所が割り振りに入っている間だけ「地図は割り振り後（28.8万人）です。この欄の数字は割り振り前です。」。タイルは割り振り前のまま |
| チャートの器 | `.chart-figure` `.chart`（inline SVG、幅 100%・最大 560px）`.chart-summary` `.chart-legend` `.chart-key`（`.key-estimate` `.key-baseline`） | 図と、その下の 1 文の要約と凡例。文字はすべて `--ink-2`、系列の色で文字を塗らない |
| 推移の 2 枚 | 人口 `.town-series`（`.series-figure` `.series-svg`）、高齢者1人を支える現役世代 `.town-support`（`.support-figure` `.support-svg`） | 同じ部品（`mountSeriesChart(host, spec)`。`SeriesChartSpec` が class・題・数字の書き方・表の文言を決め、既定は人口の `POPULATION_CHART`）。支える人数の図は、2050 年までの実線も公表値ではなくこのアプリの計算した年齢別の人口から（表の下の注記がそう言う）。表を開く文言は「支える人数の推移の数字を表で見る」（390px で 1 行）、表の数字は小数 2 桁。値の無い年（65 歳以上がいない）は線を切り、点と端の数字を描かず、表と要約は「—」。属性に NaN を書かない |
| 折れ線 | `.line .line-official / .line-estimate / .line-baseline`、`.dot .dot-official / .dot-estimate / .dot-baseline`、`.chart-grid` `.chart-border` `.chart-marker` `.chart-end` `.chart-marker-label` `.chart-unit` `.chart-caption` | 公式（墨・実線）、試算（藍・破線）、参考（灰・点線）。線 2px、点 8px 以上、2050 年の縦線 |
| ピラミッド | `.pyr-m` `.pyr-f` `.pyr-hit` `.pyramid-note` | 男は `--pyramid-m`、女は `--pyramid-f`。左右と「男」「女」の文字でも区別 |
| 表の折りたたみ | `.chart-table`（`details`）、推移の表の下に `.note.chart-table-note` | 図の数字を表でも読めるように。注記は「公式推計の列は社人研の発表値。このアプリは公表された仮定から公式の方法で計算し直しているので、2050 年までの地図や町の数字は発表値と、町では数人、都道府県では数十人ほど違うことがある」（全 1,884 地域・2025〜2050 年の全期間で確かめた：町は最大 8.1 人（2040 年、横浜市緑区）、県は最大 47 人（2050 年、北海道）、全国は最大 17 人。`townPanel.test.ts` が毎年検査する）（`seriesChart.ts` の `TABLE_NOTE`。数字は変えない） |
| 施設 | `.facility-summary`（明朝 20px）`.facility-notices` `.facility-group-title` `.facility-table`（`tbody th` は通常の太さ）`.facility-name` `.facility-guide` `.facility-note` `.facility-others`（`details`） | 施設の状態。印は `.tag` の 3 種 |
| 目安に届くには | `.facility-keep-row`（表の行。`data-keep-for`＝施設の id、下回らない間は `hidden`）`.facility-keep-cell`（`colspan=2`）`.facility-keep`（`details`。`summary` は他の折りたたみと同じ印、14px、44px）`.facility-keep-body` `.facility-keep-year`（`.note`。「2100年の人口で計算」に印 `.badge-estimate` か `.badge-official`、割り振りのパネルの `.alloc-year` と同じ形）`.facility-keep-needs`（`dl`。`.facility-keep-need` の `dt`「50%の目安（1,500人）まで」と `dd`「あと約360人」、目安が 1 つの施設は「目安（500人）まで」の 1 行だけ）`.facility-keep-what`（上に罫）`.facility-keep-premise` `.facility-keep-effect` `.facility-keep-top-lead` `.facility-keep-top` `.facility-keep-actions`（`.actions`。`.btn` の「地図に反映する」と `.facility-keep-status`＝`role=status`）`.facility-keep-error` `.facility-keep-limits`。施設の行（`tr[data-facility-id]`）は下回る間 `.has-keep`（下の罫を外し、2 行が 1 件に見える） | 下回る施設の下に出す折りたたみ。三大都市圏の町には出さない（表は参考として出しているだけ）。同時に開くのは 1 つ（開くと他は閉じ、町を替えても閉じる）。本体は最初に開く時に作り、あとは文字だけ書き換える（年を動かしてもボタンのフォーカスが残る）。計算は開いている間だけ。2050 年より後は「試算」の印を年の行に付ける。文言の正本は `src/ui/keepGuide.ts`（計算も：`keepNeeds`＝あと何人、`computeKeep`＝50% の目安に届く人数を `allocate` で他の町から人口に比例して移した時に、他の町がいくつ目安を下回るか、いちばん多い施設 3 つ）。ボタンは `keepOverlay()` で作った重ねを `store.set({ allocation })` に置くだけ（割り振りのパネルの状態は読まない。AI のパネルの「この割り振りを地図に反映する」と同じ作り）。置くとその施設に焦点が付く |
| 文の折り返し | `.keep` | 数字と単位を途中で折らない |

### 前提を変える・人口の割り振り（`controlsPanel.css`、`controls.ts`・`allocationPanel.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 前提 | `.controls-groups`（`.field` を罫で区切る）`.field-tags` `.controls-actions` `.controls-status` `#ctl-error` `#ctl-infra-custom` | スライダーと 2 択、適用と戻すのボタン、状態の 1 行 |
| 目盛りの目安（`barMarks.ts`） | `.bar-marks-intro`（スライダーとボタンの上の 1 段落。何の数字か、2020 年と 2050 年の合計）`.bar-marks`（`id` は `ctl-cwr-marks`・`ctl-migmode-marks`・`ctl-migscale-marks`・`ctl-infra-marks`）`.bar-marks-title`（`.note` の 1 行。先頭に `.badge-estimate`「試算」）`.bar-marks-list`（`dl`。`dt` が位置、`dd` が「約6,328万人」。2 列、13px、`--ink-2`）`.bar-marks-fact`（`.note`。つまみの右端から作る 1 文） | つまみやボタンの位置ごとに、その位置にしたときの 2100 年の日本全体の人口を、各操作の直下に置く。出生率のつまみ（左端・初期値・右端）、人口の移動の 2 つのボタン、移動の強さのつまみ（左端・初期値・右端）、インフラ連動の 3 つのボタン。位置はつまみの横並びに合わせず `dl` に並べる（移動の強さは初期値がつまみの 2/3 にあり、390px では 3 つの文字が重なる）。読み上げ用の文字で、フォーカスを受けず、live region でもない。各操作の `aria-describedby` に `id` を足してあるので、操作に入ると読み上げられる。つまみを動かしても変わらない（つまみの位置ではなく、つまみそのものの説明）。数字は `barMarks.ts` に定数で持ち、`barMarks.test.ts` が実データ（1,884 地域・48 施設）でエンジンを走らせて全部を照合する（上限・初期値・プリセットの強さ・エンジンのどれが変わっても落ちる）。「日本全体」は全地域に同じ前提を当てた合計（つまみは選んだ場所だけでなく全国に効く）。つまみの 1 文は数字から作り（右端が 2050 年に届くか届かないかは `reachSentence` が人数で比べる）、固定の文にしない。インフラ連動は「仮定どおりに計算した」と書き、測った効果とは書かない（既存の注意書きはその下にそのまま残す） |
| 割り振りの入力 | `.alloc-form` `.alloc-regions`（`fieldset`）`.alloc-region`（チェックボックス 20px、行 40px）`.alloc-year` | 対象・割合・引く元 |
| 地図への反映 | `.alloc-map-actions` `.alloc-map-toggle`（`aria-pressed`。「地図に反映する」/「地図に反映中」）`.alloc-map-status`（`role=status`） | 押すと store の `allocation` に今の結果を置く。年・前提・入力が変わるたびに置き直す。外す・片付けると消す。反映中は地図で別の県や町を選んでも対象を変えない（印をたどってほかの県の輪を見るため）。反映していない時は、これまでどおり地図の選択が対象になる |
| 結果 | `.alloc-result` `.alloc-summary`（role なし。年を動かすたびに書き換わる）`#alloc-announce`（`.sr-only`、`role=status`。割り振りの入力を変えた時だけ、1 回書く。年は含めない。地図が対象を動かした時は空にする）`.alloc-notes` `.alloc-more`（`details`） | 1 文の要約と施設の表。読み上げるのは入力を変えた時だけで、年のコマ送りでは読み上げない |
| 施設の表 | `.alloc-table-visible` `.alloc-table-hidden` `.alloc-group`（`th[scope=rowgroup]`）`.alloc-name.alloc-focus`（施設名のボタン：藍の下線付きの文字で 40px、押した状態は `--accent-soft` の面。`aria-pressed`、`data-facility`。押した状態はその場で書き換え、表を作り直さない：フォーカスも開いた「その他の施設」もそのまま。年や前提を変えて表を作り直した時は、同じ施設のボタン（`data-facility`）へフォーカスを戻し（画面は動かさない）、その施設が無ければ表の見出しへ）`.alloc-example` `.alloc-example-count` `.alloc-down`（減る差は `--decline-deep`） | 施設名を押すと、その施設の目安をまたいだ町に地図で印が付く |

### AI に質問（`aiPanel.css`、`aiPanel.ts`・`aiTrace.ts`）

| 族 | 主な class | 役割 |
|---|---|---|
| 入力 | `.ai-panel` `.ai-samples` `.ai-sample`（幅いっぱい・左揃え）`.ai-form` `.ai-input` `.ai-help` `.ai-counter`（`.is-over`）`.ai-input-msg` `.ai-new`（`.is-attention` は藍の 2px 枠） | 例の質問、自由入力、新しい質問。冒頭の説明 `.panel-lead` は、ビルドが AI の接続先（`VITE_CHAT_ENDPOINT`）も `endpoint` も決めていない時は、答えるという約束ではなく、接続先が無い時の札と同じ 1 文（「このバージョンでは、AIへの質問は使えません…」）。決めた時は「日本語で質問すると…」。例の質問のボタンはどちらでも付く。接続先が無いのに AI が答えた時は、最初の本物の答えのあとで後者に替わる |
| 待ち | `.ai-status` `.ai-status-text`（`role=status`）`.ai-cancel` | 1 行と「やめる」 |
| 答え | `.ai-answers` `.ai-answer`（罫で区切る。`[data-role=ai-unavailable]` は AI の接続先が無い時の 1 文で、画面に 1 つだけ。ボタンは無いが、保存済みの答えが確認済みの質問がある間は、その質問のボタン `.ai-fail-samples` が付く）`.ai-question` `.ai-answer-head` `.ai-answer-text` `.ai-basis`（数字の確認を通った答えにだけ）`.ai-estimate`（確認できなかった数字のある答えと、2051 年以降の結果を持つ失敗の札に付く「2050年より後は、このアプリの試算です」の 1 行。答えの文が 2051 年以降の年を言う時も、札の上の印 `.badge-estimate` を出す）`.ai-message` `.ai-trimmed` `.ai-fail` `.ai-fail-samples`（保存済みの答えが確認済みの質問がある時だけ） | 新しい順。保存済みは `.tag`、試算は `.badge-estimate` |
| 確かめられない数字 | `.notice.ai-warning`（墨の 4px の左罫） | 赤錆は使わない（目安を下回る印に取ってある） |
| 使った道具 | `.ai-trace`（`details`）`.ai-trace-list` `.ai-trace-item` `.ai-trace-name` `.ai-trace-label` `.ai-trace-input` `.ai-trace-result`（`details`）`.ai-json`（`pre`、paper-2 の面）`.ai-copy-status` | 入力と結果をそのまま見せる |
| 地図・前提・割り振りへの橋 | `.ai-links`（「◯◯を地図で開く」）`.ai-scenarios` `.ai-scenario` `.ai-scenario-msg`（`data-role=apply-scenario`）`.ai-allocations`（`data-role=apply-allocation`、「この割り振りを地図に反映する」） | 道具の入力から計算し直して store に置く。モデルの文章は何も使わない |

## 地図（`app.css`、`src/map/`）

| 要素 | class | 役割 |
|---|---|---|
| 面 | `.area`（fill を書き換えるだけで DOM は作り直さない）`.mesh`（紙色の境界）`.coast` | 2020 年比、または割り振りの変化 |
| 輪 | `.ring-hover`（墨 1.5）`.ring-selected`（墨 2.25）`.ring-focus`（藍 2.5）`.ring-gain`（青 2.25・実線＝人口の目安を下回らなくなった町）`.ring-loss`（赤錆 2.25・破線＝人口の目安を下回った町）。どれも紙色の halo 付き。gain・loss の halo（`.ring-gain-halo` `.ring-loss-halo`）は 7.5 と太い：その町は割り振りの対象で、輪と同じ色相の濃い面の中にあることが多いので、紙色の帯で輪を浮かせる | 重ねて描くので隣の面に隠れない |
| 印 | `.markers`（`aria-hidden`。数は面の `aria-label` とツールチップにある）`.marker`（`.marker-gain` `.marker-loss` `.marker-mixed`、`data-for`＝県コード）`.marker-dot` | 全国の地図で、焦点の施設について県ごとに目安をまたいだ町の数。県の中心に墨の点、その少し上に紙色の下地と 12px 太字の「+n −n」（小さい県の色を隠さない）。大きさは `choropleth.ts` 先頭の `MARKER_*` 定数（画面の px）で、地図の縮尺の逆数を掛けて、スマホ幅でも同じ大きさに保つ |
| 離島 | `.map-inset` `.inset-bg` `.inset-frame` `.inset-label` `.hit` | 遠い島は別の縮尺の枠に |
| 割り振りの行 | `.alloc-bar`（「地図に反映中の割り振り：」）`.alloc-bar-name`（「和歌山県 +10%」）`.alloc-bar-stale`（「この割り振りは◯年の計算です」）`.alloc-clear`（「割り振りを地図から消す」、40px。Esc でも消える：つまみ・チェックボックス・ボタンに焦点がある時も。文字を打つ欄（検索・質問の入力・選択欄・編集できる領域）の中の Esc は欄のもの、開いた dialog がある間と、ほかが処理した Esc も消さない） | 地図の上、見出しの下。消えた時にこの行にフォーカスがあれば、見出しの地名へ移す |
| 地図の最初の跳び先 | `.skip-link`（`.map-stage` の最初の子。「地図をとばして、年の選択へ」。焦点が無い間は画面の外、焦点が来ると地図の左上に藍の枠のボタンとして出る（配置は変わらない）。押すと年のつまみに焦点を移す） | 地図の Tab 停止を飛ばす |
| 地図の色 | `.map-mode`（地図のすぐ上。中は共通の `.choice`、`role=group`、`aria-label`「地図の色」、`aria-pressed` のボタン 2 つ「人口の変化」（既定）「高齢者1人を支える人数」、15px） | 押すと store の `mapMode` を置く。割り振りを地図に反映している間は隠す（割り振りの色が優先。隠す時にこのボタンにフォーカスがあれば見出しの地名へ移す）。割り振りを消すと、選んでいた色に戻る。「高齢者1人を支える人数」の間は、場所の数字が「2050年 高齢者1人を支える現役世代 1.4人　2020年は2.1人」と年の印（日本の地図では全国の値）、ツールチップと面の `aria-label` も同じ値（2050 年より後は試算の印、読み上げは「（このアプリの試算）」）、場所の読み上げも比になる |
| 凡例 | `.legend`（`data-mode="ratio" | "support" | "allocation"`）`.legend-title` `.legend-bar` `.legend-ticks` `.legend-tick` | 割り振り中は「割り振りによる人口の変化（%）」に切り替わる。支える人数の間は「色は高齢者1人を支える人数（濃いほど多い）」、6 段の帯（段の境目ははっきり）、境目ごとに「0.8人」「1人」「1.5人」「2人」「3人」の目盛（端に寄せる目盛は無い）、読み上げは「左から 0.8人未満、0.8〜1人、1〜1.5人、1.5〜2人、2〜3人、3人以上」。目盛の箱の高さはどの凡例でも同じ（切り替えても年のつまみが動かない） |

キーボード：地図は Tab 停止が 1 つだけ（`tabindex` が 0 の地域は選択中の地域、無ければ最初の地域。ほかは -1）。地図の中は矢印キーで、その向きにある中心点のいちばん近い地域へ移る（`src/map/keyboard.ts` の `nearestInDirection`：その向きに厳密にある地域だけ、横のずれは 2 倍に数える、同点は Tab 順で先のもの、端では動かない）。PageUp・PageDown は Tab 順の前と次の地域（端で止まり、回り込まない）で、矢印のどれからも最寄りにならない地域（北海道の地図の札幌市南区）にも届く。Home・End は Tab 順の最初と最後。Enter・Space は選ぶ。矢印は離島の枠（沖縄県・遠い島々）と本体の間を跨がない（北海道から上に押して沖縄県に着かない）：本体からは枠の地域に着かず、枠の地域からは枠の中だけを動く。枠の地域は PageUp・PageDown・Home・End と検索で着く。Alt・Ctrl・Cmd・Shift つきのキーはブラウザに任せる。焦点を持った地域が Tab 停止になる（選択が変わった時だけ選択中の地域に戻す）。町は検索欄からも選べる。

目印だけの class（css の規則が無く、テストやスクリプトが要素を探すためのもの）：`.ai-allocations` `.ai-basis` `.ai-cancel` `.ai-form` `.ai-links` `.ai-message` `.ai-trace` `.ai-trace-result` `.ai-trimmed` `.alloc-clear` `.alloc-map-actions` `.alloc-map-status` `.alloc-map-toggle` `.alloc-table-hidden` `.alloc-table-visible` `.head-basis` `.map-inset`。見た目は一緒に付く共通の class（`.btn`・`.note`・`.data-table` など）が決める。`.marker-mixed`（増えた町と減った町の両方がある県）は独自の色を持たず、印の文字は墨のまま。

## 数字と文言

- 人口は `formatPop()`（`src/ui/format.ts`）：8,340人 / 4.2万人 / 1,190万人 / 1億2,615万人。高齢者1人を支える人数は `formatSupport()`：2.1人 / 0.8人（小数 1 桁）、表は `formatSupportExact()`：2.08（小数 2 桁、単位は列名に）。比が出せない時は「—」（Infinity や NaN を出さない）。比に良い・悪いを付けない。増減は `formatPct()`：−31.5% / +2.5%（マイナスは U+2212）。割り振りの変化は `formatDeltaPct()`：+10.0% / −0.04% / ±0%。
- 割り振りが地図にある間、見出し・ツールチップ・面の `aria-label`・場所の読み上げは、割り振りの年と表示中の年が同じなら割り振り後の人口と 2020 年比を出し、割り振り前の人口も並べ（「28.8万人（割り振り前 26.2万人）」）、「割り振り後」の印（読み上げは「（割り振り後）」）を付ける。解釈：2050 年より後は「試算」を必ず出す、という全体の決まりのため、「割り振り後」の印は「試算」の後ろに足す（置き換えない）。2050 年まで（2020 年を含む）は、割り振り後の数字はもう公式推計（2020 年は国勢調査）の値ではないので、見出しは（その場所の数字が割り振りで実際に変わる時だけ：全国の合計は変わらないので、全国と、変化が 0 の場所では元の印のまま。`figureChanged()`）「公式推計」「実績（国勢調査）」の印を外し、「割り振り後」の印に「公式推計をもとにこのアプリが計算」（2020 年は「国勢調査をもとにこのアプリが計算」）を添える（`allocatedBasisNote()`、`.head-basis`）。ツールチップにはもともと「公式推計」の印が無い。年が違えば数字はそのまま、印も付けない。ツールチップと `aria-label` には「割り振りによる変化 +10.0%」（年が違えば「（2100年の計算）」を添える）と、焦点の施設があれば「◯◯が人口の目安を下回らなくなる」「◯◯が人口の目安を下回る」、全国の地図では「◯◯：人口の目安を下回らなくなる町 +n、下回る町 −n」を足す（町が無い側は書かない：「人口の目安を下回らなくなる町 +1」だけ、「人口の目安を下回る町 −2」だけ。言葉は町の詳細の施設の状態と同じ：「人口の目安を下回る」は `facilityStatus` が 'below'（人口 < 50% の値）、増えた町はもう下回らない（境目か上回る）。「目安以上」は使わない（「目安」が 50% の値と 50〜80% の幅の 2 つの意味になるため）。「−0」「+0」は出さない）。県の変化は `allocatedTotals()`（`src/ui/derive.ts`）で県の合計から計算する。これらの数字と文言は `src/ui/allocationView.ts`（DOM なしの関数：`allocationView`・`placeNumbers`・`allocationLines`・`countMarkers`）にあり、シェルと町の詳細の注記が同じものを使う。
- 色の幅（`allocationScale`）は最大の変化を画面と同じ小数 1 桁に丸めてから 5・10・20・30・50・100 と比べる。計算の誤差（10.000000000000018）や人数の丸め（10.0001）で +10% の割り振りが ±20 にならない。
- 2050 年より後の数字には必ず試算の印を付け、「予測」と書かない。文言の正本は `src/ui/sources.ts`（`ESTIMATE_NOTE`・`OFFICIAL_NOTE`・`badgeFor`・出典）。
- 出典（フッター）は `SOURCES`（`src/ui/sources.ts`）が正本。どの出典も、加工して作成したと書き、出典のページの URL を「文字が URL そのもののリンク」（`target=_blank` `rel=noopener`）で見せ、取得日（`docs/sources.md` の日付）を添える。測量法の承認の行は境界の出典の最後に残す。1 件は「何か」「ページと取得日」「承認の行」を `.src-text` `.src-where` `.src-approval` の 3 段に積む（スマホ幅でも読め、URL は途中で折れる）。人口の出典は「社人研がこのアプリの内容を保証するものではありません」で終える（`docs/sources.md` と README のとおり）。長い句は `word-break: auto-phrase`（Chromium）で文節で折る。
- 施設の名前は 1 つだけ：`public/data/facilities.json` の `name` を、施設の `id` で引いて出す（町の詳細の表・割り振りの表・ボタンの読み上げ・ツールチップと地図の読み上げ・割り振りの `flips`）。UI のコードに施設の名前を直接書かない（`facilityNames.test.ts` が検査する）。README や docs の言い換え（「飲食料品店」「診療所」など）は画面の名前ではない。
- 「残せない」でなく「人口の目安を下回る」。残す・残さないを勧める言葉は書かない。
- 「この目安に届くには」の文言：人数は「もし移ったら」の仮の数で、実際の人の動きの予測ではない。人口の目安は 2009〜2012 年の統計で、人口が増えれば施設ができるという因果を示さない（`KEEP_LIMITS`、1 文）。結果は事実だけ（「ほかの19町が、いずれかの施設の人口の目安を下回ります」）で、残す・残さないも、人を動かすべきかどうかも書かない。動かす人数が他の地域の人口を超える（`allocate` が RangeError）時は「人数が大きすぎて、この計算はできません。」だけを出す。
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
