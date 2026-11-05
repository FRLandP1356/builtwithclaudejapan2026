# Japan in 2100 (town-2100)

[日本語](README.md)

A map that shows Japan's population up to 2100. You drill down from Japan to a prefecture to a town and see each town's population, its age structure, and whether that population is above or below each facility's "population guideline". You can also reallocate people between regions and see what changes, and ask an AI that answers only from calculated results.

The app does not recommend what to keep or give up. It shows facts so people can decide.

The author's view (作者の見解): the author thinks that if every rural region in Japan were revitalised at the same time, it would not add up in terms of population. The app is not a proof of that view; it lays out material for checking it.

- Public page: (public URL to be added at submission)
- Status: before the hackathon submission. Nothing is published yet. The proxy (Worker) behind the free-text AI questions is not deployed either. **In this version the AI questions do not work** (see [Limits and unfinished items](#limits-and-unfinished-items)).
- Sources and terms: [docs/sources.md](docs/sources.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Development log: [docs/dev-log.md](docs/dev-log.md). The on-screen text is in Japanese.

## Try it in 3 minutes (for judges)

Until there is a public page, run it locally (see [Run, test, build](#run-test-build): `npm ci`, then `npm run dev`).

1. **Map of Japan.** Prefectures are coloured by change relative to 2020 (decline in rust red, growth in blue). The year slider at the bottom moves from 2020 to 2100 in 5-year steps.
2. **Prefecture to town.** Click a prefecture to get its municipal map. You can search by town name. Designated cities and the 23 Tokyo wards are drawn ward by ward.
3. **Town panel.** Population over time (official projection as a solid line, this app's own calculation as a dashed line), a population pyramid by 5-year age group and sex, the shares aged 65+ and 0-14, and for each facility a comparison with its "population guideline". There are 48 facility types; the 8 the app treats as essential (clinic, post office, food retail, general hospital, bank, special nursing home, day care / short-stay care, home help) come first and the rest are collapsed.
4. **「前提を変える」 (Change the assumptions).** Moves the assumptions used after 2050: how easily children are born (0.6-1.4 times the 2050 level), migration (keep the trend around 2050, or fade it to zero by 2100; strength 0-1.5), and an infrastructure-linked acceleration of depopulation (none, weak, strong). The map and numbers change immediately. Numbers up to 2050 never change.
5. **「人口の割り振り」 (Allocate population).** Keeps the national total fixed, increases (or decreases) the population of one prefecture or town, and shows how the rest change. Example: first set the year slider to 2100, then raise Wakayama Prefecture by 10% (about 26,000 people); the other regions lose the same number in total. 高野町 (Koya) goes from 470.6 to 517.7 people and crosses the 500-person guideline. Eight facility types have 500 as their guideline (food retail, restaurants, bars, hotels, post offices, clinics, dental clinics, special nursing homes). That 500 is the midpoint of the source table's 0-1,000 class, not an observed step. Since the national difference is small, results are shown as the change in the number of towns above each facility's guideline (in this example 12 of the 48 facility types change).
6. **「AIに質問」 (Ask the AI).** **In this version, the AI questions do not work. They will work after the Worker is deployed and the saved answers are created.** The screen has the sample-question buttons and an input box, but for now pressing them gives no answer, only an error message. Once it works: ask in Japanese; Claude calls calculation tools and answers from their results; open 「使った道具と数字」 under an answer to see which tool was called with what and what it returned. There are five sample questions. Their saved answers (shown instantly without a server) will be produced by having Claude answer and having the author check them before they are saved to `public/data/cached_answers.json`; at this commit all five are `pending`, and a pending placeholder is never shown. Free-text questions go through the Worker to Claude and are rate-limited per visitor (defaults: 20 per IP per day, 300 per day in total; one question can cost up to 9 model calls, so 20 is not always 20 questions). When the limit is reached, a saved answer is shown if there is one. Questions are limited to 200 characters.

Convention: every number after 2050 carries a 「試算」 (own calculation) badge and is drawn dashed. The app never calls it a forecast. Up to 2050 it says 「公式推計」 (official projection); 2020 says 「実績（国勢調査）」 (census).

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

**Facility "population guidelines"** come from the Ministry of Land, Infrastructure, Transport and Tourism (MLIT) table of the population size at which 50% (p50) and 80% (p80) of municipalities have at least one such establishment, from 2009-2012 statistics, excluding the three major metropolitan areas (11 prefectures: Saitama, Chiba, Tokyo, Kanagawa, Gifu, Aichi, Mie, Kyoto, Osaka, Hyogo, Nara). The screen shows above the guideline, borderline, or below the guideline. It is a guideline, not a prediction that a facility will close. Towns in the three metropolitan areas are marked as outside the table's scope and shown for reference.

### Limits of the numbers

- After 2050 it is a calculation under stated assumptions, not a forecast. Small towns depend more on the assumptions.
- The facility guidelines are 2009-2012 statistics; at the same population they do not match today's facilities.
- 13 villages have no published assumptions (檜枝岐村, 利島村, 御蔵島村, 青ヶ島村, 粟島浦村, 平谷村, 野迫川村, 下北山村, 上北山村, 北山村, 三島村, 座間味村, 渡名喜村). They use official values up to 2050 and then follow their prefecture's rate of change. This version has no on-screen marker for them yet.
- The base is the 2020 census and the municipal areas of around 2020; later mergers are not reflected.
- Map boundaries are coarse shapes simplified for display (not for surveying, area or administrative checks); coastlines and borders can be off by tens to hundreds of metres or more, and tiny rocks under 0.01 km2 are mostly dropped.
- The six villages of the Northern Territories (色丹村, 泊村, 留夜別村, 留別村, 紗那村, 蘂取村) are not drawn because IPSS has no figures for them; this is not a statement about territory. The Habomai Islands are included in 根室市 in the source data and so are in its shape.

## How Claude is used

**In development:** all code in this repository was written with Claude Code (the Claude command-line tool) during the hackathon period. Data, the calculation engine, the map and UI, and the AI and proxy were developed in parallel in separate git worktrees (separate working copies on disjoint paths), and every task was independently reviewed by a different Claude than the one that implemented it. Decisions, findings and rulings are kept in a ledger (the ledger itself is not in this repository; the numbers below are counted from the ledger as of this commit, before Task 10c (the allocation overlay on the map) and the final whole-branch review).

- Implementation tasks: 15 (data pipeline, calculation engine, facility table, boundary shapes, proxy, AI tools, UI shell and maps, town panel, assumptions and allocation panels, AI panel and so on)
- Independent reviews: 15 first reviews. 7 tasks were approved at once; the other 8 received findings, were fixed once each, and were approved after a second review (8 fix rounds, 8 re-reviews)
- Findings: 0 critical, 17 important (for example: the proxy let some client-supplied fields through; the daily counters could be bypassed by concurrent requests; the AI panel could freeze when a file download stalled; tests that could not fail). Details in [docs/dev-log.md](docs/dev-log.md)
- Reviews also used mutation checks (deliberately breaking the code to see whether the tests fail)

**In the product:** the 「AIに質問」 panel calls the Anthropic API (model `claude-sonnet-5-5`) through a small Cloudflare Worker. The API key lives only in the Worker, never in the browser.

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
- The Worker gives the model rules such as: do not recommend what to keep, do not call anything a forecast, do not write that a facility "cannot be kept".

## What Claude made and what the human decided

- **Made by Claude:** all source code, tests and documents in this repository, written by Claude Code. Most of the implementer and reviewer subagents (child sessions started by Claude Code) ran on Claude Sonnet 5.5. The task that decided and implemented the UI shell and visual design (Task 8) and the first part of Task 10c (work that was left uncommitted) ran on Claude Fable 5.1. Because the Fable usage limit was reached, the rest of Task 10c is being completed by a Claude Opus 5.5 implementer (not merged into the `build` branch at this commit). The model used for each individual review is not recorded one by one (the ledger's policy was Sonnet 5.5). A final whole-branch review is planned; the model is not decided (Opus 5.5 until the Fable limit resets); this will be updated at publication. The `Co-Authored-By` trailer on each commit names the model that produced it (of the 42 commits up to b2c3dfa, made 2026-11-05 09:44: 39 by Claude Sonnet 5.5 and 3 by Claude Fable 5.1; no Opus 5.5 commit is included yet, and the commit that adds this README is by Claude Sonnet 5.5). The git author field shows the name configured in the environment where the work was done; what marks Claude is the `Co-Authored-By` trailer.
- **Decided by the human:** the idea and direction (what question the map should answer), the product requirements, approval of the visual direction after seeing samples at the design gate, account and rights decisions, and the decision to publish.
- No AI-generated images or audio are used (the icon is an SVG written in code: a square and a circle). Only fonts already on the system are used; no web fonts are loaded.
- OSS dependencies (licences as declared in each package's `package.json`): D3 7.9.2 (ISC), topojson-client 3.1.0 (ISC). For development: Vite 8.3.5 (MIT), TypeScript 7.0.2 (Apache-2.0), Vitest 5.1.0 (MIT), jsdom 30.1.3 (MIT), mapshaper 0.7.101 (MPL-2.0, used to simplify boundaries), Wrangler 4.157.0 (MIT OR Apache-2.0), `@cloudflare/workers-types` and `@types/*`. No other third-party code was copied in. The Python data scripts use only the standard library.
- Pre-existing code, data, images or text: none. This repository was created after the hackathon began.

## Data sources and licences

Exact wording, retrieval dates, processing and open items are in [docs/sources.md](docs/sources.md).

| Data | Source | Terms | Use |
|---|---|---|---|
| Population projections and assumptions | IPSS "Regional Population Projections for Japan (2023 estimate)" | Public Data License 1.0 (PDL1.0) (per the records; the original wording has not been re-read) | Processed (per-area JSON; extended beyond 2050) |
| Boundaries | MLIT "National Land Numerical Information, Administrative Area Data (N03)", 2021 edition | Site terms of the download service (commercial use, redistribution and modification allowed; credit and a note that the data was processed are required). Two points are unresolved: the permission of the original provider (the Geospatial Information Authority of Japan) and whether the 測量法 approval number must be shown (open items 1 and 2 in [docs/sources.md](docs/sources.md)) | Processed (simplified and merged to match IPSS areas) |
| Facility population guidelines | MLIT National Spatial Planning Bureau, "Population size of municipalities at which service facilities are present with 50% and 80% probability (excluding the three major metropolitan areas)", 2009-2012 statistics | MLIT website terms (PDL1.0 unless noted otherwise) | Values transcribed from a chart into a table |

Credit lines:

- National Institute of Population and Social Security Research, 「日本の地域別将来推計人口（令和5年推計）」 (https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp), processed for this work. IPSS does not guarantee the content of this app.
- Ministry of Land, Infrastructure, Transport and Tourism, 「国土数値情報（行政区域データ）」 2021 edition (https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2021.html), retrieved 5 November 2026, processed for this work (simplified and merged to match IPSS areas). This is not a map made by the government. 測量法に基づく国土地理院長承認（複製）R2JHf 450
  - The last line is the notice shown on the source data page. Whether it must accompany derived data is to be confirmed with MLIT (not yet done), so it is included for now.
- MLIT National Spatial Planning Bureau, 「サービス施設の立地する確率が50％及び80％となる自治体の人口規模（三大都市圏を除く）」 (urban-area reference material, https://www.mlit.go.jp/common/001042019.pdf), values transcribed from the chart and processed into per-facility population guidelines.

The original IPSS Excel files and any data from the National Institute for Environmental Studies (NIES) are not in this repository (the app does not use NIES data). `python3 -m pipeline.fetch_sources` downloads the IPSS files from their official URLs and checks the SHA256 recorded in `pipeline/sources.json`.

## Run, test, build

Requirements: Node.js and npm (developed on Node 26). To rebuild the data, Python 3 (standard library only; developed on 3.14).

```sh
npm ci              # install dependencies
npm run dev         # dev server (http://localhost:5173)
npm test            # tests (Vitest)
npm run typecheck   # type check (app and Worker)
npm run build       # build the site into dist/
npm run test:py     # data pipeline tests (run python3 -m pipeline.fetch_sources first)
```

On the `build` branch as of 2026-11-05 (commit b2c3dfa), `npm test` passes 784 tests in 36 files, `npm run typecheck` and `npm run build` succeed, and `npm run test:py` passes 84 tests.

Rebuilding the data (the results are committed in `public/data`, so this is normally unnecessary):

```sh
python3 -m pipeline.fetch_sources     # download the IPSS Excel files into data/raw and verify SHA256
python3 -m pipeline.build_areas       # per-area population and assumptions JSON (public/data/areas, groups.json, index.json)
python3 -m pipeline.build_facilities  # facility guidelines (public/data/facilities.json)
bash pipeline/build_geometry.sh       # boundary TopoJSON (public/data/geo); downloads the N03 zips and simplifies
python3 -m pipeline.check_codes       # cross-check IPSS area codes against the boundaries
```

The AI proxy (Worker): see [worker/README.md](worker/README.md) for its behaviour and settings and [docs/ai-endpoint.md](docs/ai-endpoint.md) for how the page finds it. Deploying it needs an Anthropic API key, a spend limit and a KV namespace, which the author sets up (the key is never written in code or config files). No Worker is deployed in this version.

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

- The public page is not published. The Worker for free-text AI questions is not published either, and the AI's saved answers have not been created. So **in this version the AI questions do not work (neither the sample questions nor free text)**.
- Whether the 測量法 approval line on the N03 boundary data must be shown on derived data is unconfirmed ([docs/sources.md](docs/sources.md), open items). The permission of the original provider (the Geospatial Information Authority of Japan) is confirmed only as far as MLIT states it in its terms. The IPSS terms page could not be re-read when the sources were consolidated.
- The Worker code was reviewed repeatedly by Claude, but a review by another company's AI could not be done because of usage limits and permissions ([docs/dev-log.md](docs/dev-log.md)). Before publishing, a spend limit on the Anthropic workspace is required (it is the only reliable way to cap spending). The per-day request limits are best-effort and weak against concurrent requests.
- Not in this version: an on-screen marker for the 13 villages, past census series, and the research-data reference line.
- The screens were checked at 390 px (phone) and 1512 px (PC) widths with no horizontal scrolling.

## Licence

No LICENSE file is set in this repository. The code is published for judging, and the choice of licence is left open. The data sources keep their own terms, listed above.
