# データの出典と加工

各作業が自分の節を追記する。最後にまとめて整える。

## IPSS data（社人研の地域別将来推計人口）

**出典**: 国立社会保障・人口問題研究所（社人研）「日本の地域別将来推計人口（令和5年推計）」
https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp

**使ったファイル**（Excel の原本はリポジトリに入れない。`python3 -m pipeline.fetch_sources` で `data/raw` に取得し、`pipeline/sources.json` に記録した SHA256 で照合する）

| ファイル | 内容 | URL |
|---|---|---|
| `suikei_kekka.xlsx` | 市区町村別・男女5歳階級別の推計人口（2020年は国勢調査、2025〜2050年） | https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/3kekka/suikei_kekka.xlsx |
| `katei_suvr.xlsx` | 仮定値: 生残率 | https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/4shihyo/katei_suvr.xlsx |
| `katei_nmigr.xlsx` | 仮定値: 純移動率 | https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/4shihyo/katei_nmigr.xlsx |
| `katei_cwr_0-4sr.xlsx` | 仮定値: 子ども女性比・0〜4歳性比 | https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/4shihyo/katei_cwr_0-4sr.xlsx |

**ライセンス**: 公共データ利用規約（第1.0版、PDL1.0）。出典を明記し、加工したことを明記する。
画面と README には「国立社会保障・人口問題研究所『日本の地域別将来推計人口（令和5年推計）』を加工して作成」と書く。社人研がこのアプリの内容を保証するものではない。

**加工の内容**（`pipeline/build_areas.py`）

1. 地域は IPSS の「市などの別」が 0（政令市の区、東京23区を含む）・2（その他の市）・3（町村）・9（福島県浜通り地域）の1,884地域。計算の単位はこの地域で、1（政令市の合計）と a（都道府県の合計）は計算しない。
2. 2020年の男女5歳階級別人口（0〜4歳から95歳以上の20区分）を `base`、2025〜2050年の総人口を `official` として取り出した。
3. 生残率・純移動率は期間の始まりの年（2020〜2045年）で、子ども女性比・0〜4歳性比は期間の終わりの年（2025〜2050年）で引き、6期間（2020→25 … 2045→50）の仮定として並べた。
4. 純移動率に値のない13村（檜枝岐村・利島村・御蔵島村・青ヶ島村・粟島浦村・平谷村・野迫川村・下北山村・上北山村・北山村・三島村・座間味村・渡名喜村）は仮定を `null` とし、社人研の2025〜2050年の男女5歳階級別人口を `officialAges` に残した。
5. 地域コードを5桁にそろえた（IPSS は先頭の0を落としている）。小数は有効数字6桁に丸めた。
6. 政令市と区、都道府県と地域の対応は Excel の行の並び（市の行の直後にその区が並ぶ）から作り `groups.json` にした（東京23区はどの政令市にも属さない）。政令市・都道府県の合計は、社人研の合計の行と一致することを確認している。

**生成物**: `public/data/areas/<都道府県コード>.json`（47ファイル）、`public/data/groups.json`、`public/data/index.json`。

**注意**: `official`（2025〜2050年）は社人研の推計値そのもの。2050年より先は、このアプリが社人研の仮定を延ばして出した試算で、社人研の推計ではない。田辺市の2050年は社人研の値が42,309人で、田辺市人口ビジョン案（令和7年1月）の42,311人とは2人違う（このアプリは社人研の値を使う）。
