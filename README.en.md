# Japan in 2100 (town-2100)

[日本語](README.md)

A map that shows Japan's population up to 2100. You drill down from Japan to a prefecture to a town and see each town's population, its age structure, and whether that population is above or below each facility's "population guideline". You can also reallocate people between regions and see what changes. An AI is meant to call the app's own calculations as tools and answer from their results (in this version the AI questions do not work).

The app does not recommend what to keep or give up. It shows facts so people can decide.

The author's view (作者の見解): the author thinks that if every rural region in Japan were revitalised at the same time, it would not add up in terms of population. The app is not a proof of that view; it lays out material for checking it.

- Public page: (public URL to be added at submission)
- Status: before the hackathon submission. Nothing has been deployed: there is no public page, no proxy (Worker) for the free-text AI questions, and no saved AI answers yet. **In this version the AI questions do not work** (see [Limits and unfinished items](#limits-and-unfinished-items)). The numbers in this document are as of commit fa21f09 (2026-11-06).
- Sources and terms: [docs/sources.md](docs/sources.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Development log: [docs/dev-log.md](docs/dev-log.md). The on-screen text is in Japanese.

## Try it in 3 minutes (for judges)

Until there is a public page, run it locally (see [Run, test, build](#run-test-build): `npm ci`, then `npm run dev`).

1. **Map of Japan.** It opens at 2050, the last year of the IPSS official projection. Prefectures are coloured by change relative to 2020 (decline in rust red, growth in blue). To see 2100, press the play button (▶) of the year slider at the bottom or move the slider; it runs from 2020 to 2100 in 5-year steps.
2. **Prefecture to town.** Click a prefecture to get its municipal map. You can search by town name. Designated cities and the 23 Tokyo wards are drawn ward by ward.
3. **Town panel.** Population over time (official projection as a solid line, this app's own calculation as a dashed line), a population pyramid by 5-year age group and sex, the shares aged 65+ and 0-14, and for each facility a comparison with its "population guideline". There are 48 facility types; the 8 the app treats as essential come first and the rest are collapsed. The on-screen names of the 8 are 飲食料品小売業 (food retail), 郵便局 (post office), 銀行（中央銀行を除く） (banks, central bank excluded), 一般診療所 (general clinic), 介護老人福祉施設 (special nursing home), 一般病院 (general hospital), 通所・短期入所介護事業 (day care / short-stay care) and 訪問介護事業 (home help). Facility names on screen are the names in `public/data/facilities.json` (the AI writes its own wording, which can differ).
4. **「前提を変える」 (Change the assumptions).** Moves the assumptions used after 2050: how easily children are born (0.6-1.4 times the 2050 level), migration (keep the trend around 2050, or fade it to zero by 2100; strength 0-1.5), and an infrastructure-linked acceleration of depopulation (none, weak, strong). The map and numbers change immediately. Numbers up to 2050 never change.
5. **「人口の割り振り」 (Allocate population).** Keeps the national total fixed, increases (or decreases) the population of one prefecture or town, and shows how the rest change. To try it: (1) set the year slider to 2100; (2) in 「人口の割り振り」 choose Wakayama Prefecture in 「人口を増減させる地域」 (it is the starting choice when nothing is selected; the percentage starts at +10%); (3) press 「地図に反映する」 ("show on the map"). The map colours then show the change in population caused by the allocation. Raising Wakayama Prefecture by 10% (about 26,000 people) makes the other regions lose the same number in total. 高野町 (Koya) goes from 470.6 to 517.7 people and is no longer below the 500-person guideline. Eight facility types have 500 as their guideline (「飲食料品小売業」 food retail, 「飲食店」 restaurants, 「酒場、ビアホール」 bars, 「旅館、ホテル」 hotels, 「郵便局」 post offices, 「一般診療所」 clinics, 「歯科診療所」 dental clinics, 「介護老人福祉施設」 special nursing homes). That 500 is the midpoint of the source table's 0-1,000 class, not an observed step. Since the national difference is small, results are shown as the change in the number of towns that are no longer below, or that fall below, each facility's guideline (in this example 12 of the 48 facility types change). Pressing a facility name in the table marks the towns that crossed its guideline: on a prefecture map as rings (blue solid = no longer below the guideline, rust-red dashed = below the guideline), on the national map as one marker per prefecture ("+n −n"). To clear the allocation, press 「割り振りを地図から消す」 (shown while an allocation is on the map) or the Esc key (Esc does nothing while the focus is in a text field or a select).
6. **「AIに質問」 (Ask the AI).** **In this version, the AI questions do not work.** The 「AIに質問」 panel has an input box and five sample-question buttons, but pressing them gives no answer. The panel says 「このバージョンでは、AIへの質問は使えません（AIの接続先がまだ用意されていません）。地図、数値、前提の調整、人口の割り振りはそのまま使えます。」 ("AI questions are not available in this version (no AI endpoint has been set up yet). The map, the numbers, the assumptions and the population allocation work as usual."). That sentence appears when nothing answers as the Worker (a 404 or 405, or a reply that is not the Worker's). When the connection fails, or the endpoint says it cannot serve right now (a rate limit, a Worker fault), the panel instead says 「いまはAIに接続できません。時間をおいて、もう一度お試しください。」 ("The AI cannot be reached right now. Please try again later."). (On a page opened from a file, a failed connection to the default address gives the first sentence; once an endpoint has answered, a 404 or 405 also gives this second sentence.) No saved answer has been made yet (the five entries in `public/data/cached_answers.json` are all `pending`, and a pending placeholder is never shown), so no 「保存済みの質問」 (saved question) button is shown either.

   What follows describes how it is meant to work after the Worker is deployed (not in this version). Ask in Japanese; Claude calls calculation tools and answers from their results; open 「使った道具と数字」 under an answer to see which tool was called with what and what it returned. There are five sample questions. Their saved answers (shown instantly without a server) will be produced by having Claude answer and having the author check them before they are saved to `public/data/cached_answers.json`; only verified ones are ever shown. Free-text questions go through the Worker to Claude and are rate-limited (defaults: 60 per IP per day and 400 per day in total, counted in upstream calls; one question can cost up to 9 model calls, so 60 is not always 60 questions; plus at most 20 per 60 seconds per IP). When a limit is reached, a verified saved answer is shown if there is one. Questions are limited to 200 characters.

Convention: every number after 2050 carries a 「試算」 (own calculation) badge and is drawn dashed. The app never calls it a forecast. Up to 2050 it says 「公式推計」 (official projection); 2020 says 「実績（国勢調査）」 (census). While an allocation is on the map, a figure up to 2050 that the allocation changed is no longer the official value but this app's own calculation, so the headline shows 「割り振り後」 and the note 「公式推計をもとにこのアプリが計算」 instead of 「公式推計」. AI answer cards follow the same rule: an answer that shows or names a year after 2050 (and, when in doubt, it is treated as naming one) carries the 「試算」 badge and the note 「2050年より後は、このアプリの試算です（予測ではありません）」.

The map can also be used from the keyboard. Tab enters a map at a single stop per map (a link 「地図をとばして、年の選択へ」, "skip the map, go to the year", appears in front of it). Arrow keys move to the neighbouring area in that direction, PageUp and PageDown to the previous and next area, Home and End to the first and last area, and Enter or Space select. With PageUp/PageDown every area can be reached, including those the arrows cannot reach (a test checks this on the national map and on all 47 prefecture maps).

## Where the numbers come from and how they are checked

**Base data:** the National Institute of Population and Social Security Research (IPSS), "Regional Population Projections for Japan (2023 estimate, reiwa 5)". It publishes municipal projections to 2050 from the 2020 census, and the assumptions behind them (survival rates, net migration rates, children-women ratio, sex ratio at 0-4) per municipality. There is no official municipal projection beyond 2050.

**This app's calculation** is its own cohort-component engine (5-year age groups, by sex, 5-year steps) driven by those assumptions. First, it was checked that the published assumptions reproduce the official 2050 results (1,871 municipalities with published assumptions):

| Year | Per-municipality population error: median | 90% of municipalities within | Max |
|---|---|---|---|
| 2025 | 0.0039% | 0.042% | 0.705% |
| 2030 | 0.0041% | 0.051% | 0.995% |
| 2040 | 0.0049% | 0.057% | 0.841% |
| 2050 | 0.0053% | 0.076% | 1.39% |

In 2050, 99.47% of municipalities are within 0.5%. The national total is 104,686,401 (this app) against 104,686,386 (official), over all 1,884 areas (the 13 villages without published assumptions use the official age-group populations as they are). The tests check this on every run (they fail unless the 2050 median error is within 0.01%, at least 98% of municipalities are within 0.5%, and the max is within 2%). How this was found is in [docs/dev-log.md](docs/dev-log.md).

This app's numbers up to 2050 can differ from IPSS's published values by a few people for a town and a few tens for a prefecture (the tests check this on all 1,884 areas: under 10 for a town, under 100 for a prefecture). For example, 田辺市 (Tanabe) in 2050 is 42,309 in IPSS's table and 42,311 in this app's calculation. Opening 「人口の推移の数字を表で見る」 ("see the numbers as a table") in the town panel shows the same note under the table.

**After 2050**, by default the assumptions of the 2045-2050 period are held constant. The national 2100 total is 63,279,524 (63.28 million), close to IPSS's separately published long-range reference projection (2071-2120; medium fertility, medium mortality: 62.78 million in 2100). The assumptions can be changed on screen:

| National population in 2100 | This app's calculation |
|---|---|
| Assumptions held (default) | 63.28 million |
| Migration fades to zero by 2100 | 58.52 million |
| Children-women ratio x1.2 | 70.93 million |
| Children-women ratio x0.8 | 56.34 million |
| Fade and x1.2 | 65.06 million |

When migration stops, the national total falls, but small shrinking towns can end up with more people because their net out-migration also stops (Tanabe City goes from 11,880 to 13,690 in 2100).

**The infrastructure-linked acceleration of depopulation** is an assumption added by this app. The official assumptions do not tie migration to the presence of hospitals or shops. This assumption says that when an essential facility falls below its population guideline, more people leave. There is no empirical basis for how many more; it is only there to show a range, and it is off by default.

**Facility "population guidelines"** come from the Ministry of Land, Infrastructure, Transport and Tourism (MLIT) table of the population size at which 50% (p50) and 80% (p80) of municipalities have at least one such establishment, from 2009-2012 statistics, excluding the three major metropolitan areas (11 prefectures: Saitama, Chiba, Tokyo, Kanagawa, Gifu, Aichi, Mie, Kyoto, Osaka, Hyogo, Nara). For each facility the screen shows a town as 「人口の目安を上回る」 (above the guideline: at or above the 80% value), 「境目」 (borderline: from the 50% value up to the 80% value) or 「人口の目安を下回る」 (below the guideline: under the 50% value); a facility whose 50% and 80% values are equal has no borderline band. It is a guideline, not a prediction that a facility will close. Towns in the three metropolitan areas are marked as outside the table's scope and shown for reference.

### Limits of the numbers

- After 2050 it is a calculation under stated assumptions, not a forecast. Small towns depend more on the assumptions.
- The facility guidelines are 2009-2012 statistics; at the same population they do not match today's facilities.
- 13 villages have no published assumptions (檜枝岐村, 利島村, 御蔵島村, 青ヶ島村, 粟島浦村, 平谷村, 野迫川村, 下北山村, 上北山村, 北山村, 三島村, 座間味村, 渡名喜村). They use official values up to 2050 and then follow their prefecture's rate of change. This version has no on-screen marker for them yet.
- The base is the 2020 census and the municipal areas of around 2020; later mergers are not reflected.
- Map boundaries are coarse shapes simplified for display (not for surveying, area or administrative checks); coastlines and borders can be off by tens to hundreds of metres or more, and tiny rocks under 0.01 km2 are mostly dropped.
- The six villages of the Northern Territories (色丹村, 泊村, 留夜別村, 留別村, 紗那村, 蘂取村) are not drawn because IPSS has no figures for them; this is not a statement about territory. The Habomai Islands are included in 根室市 in the source data and so are in its shape.

## How Claude is used

**In development:** according to the author, all code in this repository was written by Claude Code (the Claude command-line tool); see "What Claude made and what the human decided" below. The commits were made during the hackathon period, on 5 and 6 November 2026 (the first commit is 5 November 06:19; the throw-away prototype and the research outside the repository came before it). Data, the calculation engine, the map and UI, and the AI and proxy were developed in parallel in separate git worktrees (separate working copies on disjoint paths), and each task was reviewed by a Claude session separate from the one that implemented it (same model family; not a human, not another vendor's AI). Decisions, findings and rulings are kept in a ledger. The ledger, the task briefs and reports, the design document, the implementation plan and the screenshots are not in this repository (you cannot open them from here). The numbers below were recounted from the ledger, the reports and git at commit fa21f09.

- Implementation tasks: 17 (data pipeline, calculation engine, facility table, boundary shapes, proxy, AI tools, UI shell and maps, town panel, assumptions and allocation panels, AI panel, the allocation display on the map, documentation)
- Per-task reviews (a separate Claude Sonnet 5.5 session, per the ledger's policy; the model of each single review was not recorded): all 17 tasks were reviewed. 7 were approved at the first review; the other 10 received findings, were fixed once each, and were approved after a second review (10 fix rounds, 10 re-reviews)
- Findings of those reviews: 0 critical, 26 important (for example: the proxy let some client-supplied fields through; the daily counters could be bypassed by concurrent requests; the AI panel could freeze when a file download stalled; tests that could not fail). Details in [docs/dev-log.md](docs/dev-log.md)
- Final whole-branch reviews (5 November 2026; two Claude Opus 5.5 reviewers; A: security, publication and honesty of the documents, B: real use and usability): A found 1 critical (this README described an earlier state; fixed by the documentation update of 6 November 2026) and 5 important (among them: the proxy's upstream request would not be accepted by the live API); B found 0 critical and 5 important (among them: a screen that offered AI questions that cannot work, and every map area being a Tab stop)
- Fix wave (6 November 2026): those findings were fixed in four streams (proxy / AI and allocation panels / map, shell and footer / data-pipeline guards and ignore rules). Each stream had an implementer (Claude Sonnet 5.5), a task review (Claude Opus 5.5 for the proxy, Claude Sonnet 5.5 for the others) and re-reviews after fixes: 7 review passes in all, which found 8 important and 0 critical issues. The pipeline stream had one review and one fix round and no re-review. For the other streams the last fix round was not re-reviewed either; the coordinating Claude session (the controller) read the production-code diff instead (no human did)
- Reviews also used mutation checks (deliberately breaking the code to see whether the tests fail)
- Claude Code's automated security check also commented during the work; the ledger records three comments (the check's own log is not available). They were about the proxy accepting tool definitions from the browser and how IPs are stored, the file name used by the data downloader, and a failed write of the daily counter. The first and third led to changes in the proxy (tool definitions are held on the Worker side; the daily total is split over 16 keys); for the second, a check on the download file name was added in the fix wave
- **No review by another vendor's AI took place.** The other vendors' review tools were not usable (Codex had hit its usage limit; Antigravity was blocked by its permission settings). Every review was done by Claude

**In the product** (not working in this version, because no Worker is deployed; this describes the design and what the tests check): the 「AIに質問」 panel calls the Anthropic API (model `claude-sonnet-5-5`) through a small Cloudflare Worker. The API key lives only in the Worker, never in the browser.

- Claude answers by calling 8 calculation tools. The tool names, descriptions and input shapes are fixed on the Worker's side; values sent from the browser are not used.
  1. `find_area`: find an area's code from its name
  2. `get_series`: an area's population over time (including the 65+ count and share)
  3. `compare_sources`: official projection against this app's calculation
  4. `run_projection`: recalculate under changed assumptions
  5. `facility_check`: compare a town's population with the facility guidelines
  6. `run_allocation`: calculate a population reallocation
  7. `find_similar_now`: find towns whose current population is close to a place's projected 2100 population
  8. `count_areas`: count areas that meet a condition
- The tools run the same calculation engine inside the browser. Claude explains the results in Japanese.
- **The numbers in an answer are checked for whether they appear in the calculation results** (a small error is allowed: the larger of half a unit of the last digit shown and 0.5% of the value). The check only looks for the same number somewhere in the tool results of that question. It does not check that the number belongs to the right town or year, or that the explanation is correct. If a number is not found, the model is asked once to restate the answer using only numbers from the results. An answer that still has unverified numbers is shown with a warning (「次の数字は、計算の結果で確かめられませんでした」). Sums or ratios the model computes itself (for example "about 28%") are not in the tool results and are flagged. These are not checked: list numbers at the start of a line ("1.", "(3)"), digits right after a letter ("p50"), digits after 第, plain integers followed by 年 歳 代 位 番 月 日 章 節 号 条 ("2050年", "65歳以上", "11月5日"), 4-digit integers from 1900 to 2100 (years) that have no counter such as 人 世帯 戸 円 件 軒 台, 2- or 5-digit integers equal to an area code that appears in the results (when no such counter follows), integers 0-10 with no unit, %, 倍/割, decimal point or thousands comma, and dates such as "2026/11/05". Kanji numerals (for example 三万人) are not read.
- Humans can check the calculation: 「使った道具と数字」 opens under each answer. For allocation questions the map can be moved to the same state.
- The model's output is rendered as plain text only, never parsed as HTML.
- How the Worker protects itself: `messages` from the browser are rebuilt from checked fields (the one exception is the `input` of a `tool_use` block: any JSON object is passed on as received, and only counted in the total text limit); the upstream request is built only from constants, those `messages` and the tool definitions, redirects are not followed, every response carries `nosniff`, an unexpected failure becomes a 500 of one fixed shape, and the Worker logs only fixed strings (Workers Logs; no client IP or API key). Cloudflare may attach its own metadata to a recorded line, which cannot be checked outside the real environment; that is unverified and is checked in step 9 of the deploy checklist. The daily counting lets a request through when a write fails and stops it when a read fails. Details in [worker/README.md](worker/README.md).
- The Worker gives the model rules such as: do not recommend what to keep, do not call anything a forecast, do not write that a facility "cannot be kept".

## What Claude made and what the human decided

- **Made by Claude:** all source code, tests and documents in this repository (this README included). **According to the author**, the author edited none of them by hand; all of it was written by Claude Code. Git history alone cannot confirm this (every commit shows the same author name, from the author's git configuration; the ledger of the work records only changes made as tasks handed to Claude). The implementer and reviewer subagents (child sessions started by Claude Code) and the coordinating ("controller") session that hands out the work and checks the results are Claude too. What git can show is that 152 commits carry a Claude `Co-Authored-By` line (the one without is a merge commit, 21925a4, that only brings a branch up to date).
  - **153 commits in total** (at commit fa21f09; `git rev-list --count fa21f09` counts them again, without the documentation commits made after it). Of the 133 non-merge commits, Claude Sonnet 5.5 made 113, Claude Opus 5.5 17 and Claude Fable 5.1 3. Of the 20 merge commits, 18 name Claude Sonnet 5.5, 1 names Claude Opus 5.5 and 1 has no `Co-Authored-By` line. The `Co-Authored-By` trailer of each commit was written on the coordinating session's instruction; it is not recorded automatically. For non-merge commits it names the model the task was assigned to; the 17 Claude Opus 5.5 commits also contain lines Claude Fable 5.1 wrote (next item).
  - **The 3 Fable 5.1 commits** are the task that decided and implemented the UI shell, maps and visual design (Task 8). **The 17 Opus 5.5 commits** are Task 10c (the allocation display on the map and small UI fixes). Fable started Task 10c but reached its usage limit and left about 1,300 lines of unfinished work (never committed, in the working directory); an Opus 5.5 implementer assessed it, completed and verified it, and committed it under its own name. The figure of about 1,300 lines comes from the working records; it is not in git.
  - **The `Co-Authored-By` trailer of a merge commit** was set by instruction to name the model of the coordinating session at the time of the merge; it does not name the model that made the merged work. One of them (b04bf82) says Claude Opus 5.5 although, according to the work record, the coordinating session was Claude Sonnet 5.5 at the time (the record is not in git): that one trailer is inaccurate. History has not been rewritten.
  - The model of each review is not in the commits (see "In development" above).
  - The `Claude-Session` lines on the commits are of two different kinds (64 and 88 commits). Both point into the author's private sessions, so they cannot be opened as links.
  - The git author field shows the name configured in the environment where the work was done; what marks Claude is the `Co-Authored-By` trailer.
- **Decided by the human:** the idea and direction (what question the map should answer, including the 作者の見解 at the top), the product requirements, the project name 「2100年の日本」, approval of the visual direction after seeing samples at the design gate, account and rights decisions, and whether to publish (publishing needs the author's approval and has not happened).
- **Not made by Claude:** the population projections and assumptions (IPSS), the administrative boundaries (MLIT National Land Numerical Information, originally from the Geospatial Information Authority of Japan) and the facility population-size chart (MLIT National Spatial Planning Bureau) are those organisations' data. `public/data` in this repository is that data processed by scripts Claude wrote; the facility table is Claude's transcription of the chart's numbers (the original numbers are MLIT's). The original IPSS Excel files are not in the repository. The libraries listed below were not made by Claude either.
- No AI-generated images or audio are used (the icon is an SVG written in code: a square and a circle). Only fonts already on the system are used; no web fonts are loaded.
- OSS dependencies (licences as declared in each package's `package.json`): D3 7.9.2 (ISC), topojson-client 3.1.0 (ISC). For development: Vite 8.3.5 (MIT), TypeScript 7.0.2 (Apache-2.0), Vitest 5.1.0 (MIT), jsdom 30.1.3 (MIT), mapshaper 0.7.101 (MPL-2.0, used to simplify boundaries), Wrangler 4.157.0 (MIT OR Apache-2.0), `@cloudflare/workers-types` and `@types/*`. No other third-party code was copied in. The Python data scripts use only the standard library.
- Pre-existing material: nothing made before the hackathon was reused (code, images or text). This repository was created after the hackathon began. External data is used, as above, by processing the organisations' own data.

## Data sources and licences

Exact wording, retrieval dates, processing and open items are in [docs/sources.md](docs/sources.md).

| Data | Source | Terms | Use |
|---|---|---|---|
| Population projections and assumptions | IPSS "Regional Population Projections for Japan (2023 estimate)" | Public Data License 1.0 (PDL1.0) (per the records; the original wording has not been re-read) | Processed (per-area JSON; extended beyond 2050) |
| Boundaries | MLIT "National Land Numerical Information, Administrative Area Data (N03)", 2021 edition | Site terms of the download service (commercial use, redistribution and modification allowed; credit and a note that the data was processed are required). Two points are unresolved: the permission of the original provider (the Geospatial Information Authority of Japan) and whether the 測量法 approval number must be shown (open items 1 and 2 in [docs/sources.md](docs/sources.md)) | Processed (simplified and merged to match IPSS areas) |
| Facility population guidelines | MLIT National Spatial Planning Bureau, "Population size of municipalities at which service facilities are present with 50% and 80% probability (excluding the three major metropolitan areas)", 2009-2012 statistics | MLIT website terms (PDL1.0 unless noted otherwise) | Values transcribed from a chart into a table |

Credit lines (the footer of the page shows the same three sources too, each with its URL, retrieval date and a note that the data was processed; the boundary line carries the approval line, and the population line says that IPSS does not guarantee the content of the app):

- National Institute of Population and Social Security Research, 「日本の地域別将来推計人口（令和5年推計）」 (https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp), retrieved 5 November 2026, processed for this work. IPSS does not guarantee the content of this app.
- Ministry of Land, Infrastructure, Transport and Tourism, 「国土数値情報（行政区域データ）」 2021 edition (https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2021.html), retrieved 5 November 2026, processed for this work (simplified and merged to match IPSS areas). This is not a map made by the government. 測量法に基づく国土地理院長承認（複製）R2JHf 450
  - The last line is the notice shown on the source data page. Whether it must accompany derived data is to be confirmed with MLIT (not yet done), so it is included for now.
- MLIT National Spatial Planning Bureau, 「サービス施設の立地する確率が50％及び80％となる自治体の人口規模（三大都市圏を除く）」 (urban-area reference material, https://www.mlit.go.jp/common/001042019.pdf), retrieved 5 November 2026, values transcribed from the chart and processed into per-facility population guidelines.

The original IPSS Excel files and any data from the National Institute for Environmental Studies (NIES) are not in this repository (the app does not use NIES data). `python3 -m pipeline.fetch_sources` downloads the IPSS files from their official URLs and checks the SHA256 recorded in `pipeline/sources.json`.

## Run, test, build

Requirements: Node.js and npm (developed on Node 26). To rebuild the data, Python 3 (standard library only; developed on 3.14).

```sh
npm ci              # install dependencies
npm run dev         # dev server (http://localhost:5173)
npm test            # tests (Vitest)
npm run typecheck   # type check (app and Worker)
npm run build       # build the site into dist/ (no source maps)
npm run test:py     # data pipeline tests (same as python3 -m unittest; run python3 -m pipeline.fetch_sources first)
```

Checked on the `build` branch at commit fa21f09 (2026-11-06):

- `npm test`: 1241 tests in 50 files, all pass
- `npm run typecheck` (app and Worker) and `npm run build`: no errors or warnings; no source map (`.map`) is written to `dist/`
- `python3 -m unittest`: with `data/raw` present (fetch it with `python3 -m pipeline.fetch_sources`) all 122 tests pass; without it 101 tests run and the 4 test classes that need the data stop with a "file is missing" error

Rebuilding the data (the results are committed in `public/data`, so this is normally unnecessary):

```sh
python3 -m pipeline.fetch_sources     # download the IPSS Excel files into data/raw and verify SHA256
python3 -m pipeline.build_areas       # per-area population and assumptions JSON (public/data/areas, groups.json, index.json)
python3 -m pipeline.build_facilities  # facility guidelines (public/data/facilities.json)
bash pipeline/build_geometry.sh       # boundary TopoJSON (public/data/geo); downloads the N03 zips and simplifies
python3 -m pipeline.check_codes       # cross-check IPSS area codes against the boundaries
```

The AI proxy (Worker): see [worker/README.md](worker/README.md) for its behaviour and settings and [docs/ai-endpoint.md](docs/ai-endpoint.md) for how the page finds it. Deploying it needs an Anthropic API key, a spend limit on its workspace, the Cloudflare Workers Paid plan and a KV namespace, which the author sets up (the key is never written in code or config files). No Worker is deployed in this version.

### Repository layout

| Path | Contents |
|---|---|
| `src/engine` | The calculation engine (population, assumptions, facility status, allocation). Independent of the UI and the AI |
| `src/data` | Data loading, and a runner that computes all areas and memoises the result |
| `src/map` | Map drawing (Japan, prefectures, colours, legend) |
| `src/ui` | The UI (shell, town panel, assumptions, allocation, AI panel) and its design note `DESIGN.md` |
| `src/ai` | AI tools, the answer number check, the client for the Worker, saved answers |
| `worker` | The Cloudflare Worker that proxies the Claude API |
| `pipeline` | Python that builds `public/data` from IPSS, N03 and the facility table |
| `public/data` | Built area data, boundaries and facility guidelines |
| `test` | Test helpers and fixtures |
| `docs` | Sources, design and development log |

## Limits and unfinished items

- **Nothing has been published.** There is no public page, no proxy (Worker) for the AI and no saved AI answer yet. So **in this version the AI questions do not work (neither the sample questions nor free text)**.
- **Whether the live Anthropic API accepts what the Worker sends has not been checked.** The request the Worker sends upstream (model `claude-sonnet-5-5`, `max_tokens` 3000, `effort` low, adaptive thinking with `block_binding`, a cache marker on the system prompt, redirects not followed) was built against the official documentation and checked only by tests against fake responses. It has never been sent to the real API. Step 9 of the deploy checklist in [worker/README.md](worker/README.md) is where this is checked.
- **The cost estimate is not a guarantee.** The Worker's estimate is about 0.17 dollars for a worst single call, and about 68 dollars as the most that 400 counted calls (the daily limit) can cost. But the daily count is a best-effort mechanism, and concurrent requests or failed writes let calls through beyond the limits; the table in [worker/README.md](worker/README.md) shows the overshoot can be much higher (about 221 dollars for 1,300 calls when waves of concurrent requests continue; about 204 dollars for 1,200 calls from one visitor sending concurrently). The only reliable stop on spending is the spend limit that must be set on the Anthropic workspace before publishing.
- Whether the 測量法 approval line on the N03 boundary data must be shown on derived data is unconfirmed ([docs/sources.md](docs/sources.md), open items). The permission of the original provider (the Geospatial Information Authority of Japan) is confirmed only as far as MLIT states it in its terms. The IPSS terms page could not be re-read when the sources were consolidated.
- **No review by another vendor's AI took place.** Codex had hit its usage limit and Antigravity was blocked by its permission settings ([docs/dev-log.md](docs/dev-log.md)). Every review of the Worker code was also by Claude (the per-task reviews, a security review and a whole-branch review by Claude Opus 5.5, and Claude Code's automated security check). Publishing the Worker needs the author's approval, and the author decides this point too.
- Not in this version: an on-screen marker for the 13 villages, past census series, and the research-data reference line.
- Screen checks: the final whole-branch review (commit b04bf82) checked 390, 768, 1024 and 1512 px widths with no horizontal scrolling (at 320 px only a table scrolls sideways inside itself). The whole of commit fa21f09 was checked on the morning of 6 November 2026 by the coordinating Claude session, at 390 px first and then at a wide screen (the width of the window). It checked: no horizontal scroll; it opens at 2050; the national view for 2100 (63.28 million, −49.8% against 2020, with the 「試算」 badge); the Wakayama allocation map (the national map and the prefecture map, with the ring around 高野町); the plain "AI not available" card (no buttons); the footer. The browser console showed no error other than the expected 404 for `/api/chat`. The record of this check is in the ledger; like the screenshots, it is not in this repository. In the fix wave the two streams that touch the screen (AI and allocation panels; map, shell and footer) each checked 390 px and a wide screen (the proxy and pipeline streams did not touch the screen).

## Licence

No LICENSE file is set in this repository. The code is meant to be published for judging, and the choice of licence is left open (nothing has been published yet). The data sources keep their own terms, listed above.
