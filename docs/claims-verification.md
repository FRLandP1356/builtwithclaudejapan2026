# 裏取り記録（公表資料の引用）

2026-11-07 に、各資料を取り直して、引用が本文に一字一句あることを確かめた記録。画面に出すのは、このうち「人口減少との関係を、引用そのものが述べている」と判断した 34 件（`public/data/claims.json`）。残りの 10 件（引用が人口に触れていない・全国の話で県に結びつかないもの）は画面に出していない。調査は Claude Code（Sonnet 5.5）が行い、引用の照合は別に、作者側の Claude Code が全 44 件を取り直して行った（44 件中 44 件一致）。元の記録にある `_tools/rt.py` は調査担当の作業用の道具で、このリポジトリには入れていない。

---


確認日：2026-11-07。方法：各 source を curl で取り直して PDF/HTML をテキスト化し（`_tools/rt.py verify`）、quote が本文に一字も変えずに在ることを機械的に照合した（空白だけ無視。同じ照合を 2 回、別の取得で実施し 44/44 一致）。quote の長さは最長 78 字（空白除く）。言い換え（paraphrase）が原文を超えていないかは、各項目を私が原文と並べて読んで確認した。

## 項目ごと（開いた URL・資料の日付・原文のどこ・言い換えの確認）

- `jrs-all-common` JR四国（四国全域の線区）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：第6章 総括検証「全線区の共通課題」の外部要因欄（P.70）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-all-1000` JR四国（平均通過人員が1,000人/日未満の線区）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：第7章 事業の抜本的改善方策の検討（その2）（P.75）。括弧内と「議論・検討を進めていく必要がある」は同じ文の続き｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-all-plan2026` JR四国｜https://www.jr-shikoku.co.jp/04_company/jigyou/suishin2026-2030.pdf｜資料の日付 2026-08｜原文の場所：1 策定の経緯と目的 (1) 策定の経緯｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-yosan-takamatsu-matsuyama` JR四国 予讃線（高松～松山）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-yosan-matsuyama-uwajima` JR四国 予讃線（松山～宇和島）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-yosan-umimawari` JR四国 予讃海回り線（向井原～伊予大洲）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=possibility
- `jrs-kotoku` JR四国 高徳線（高松～徳島）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-dosan-tadotsu-kochi` JR四国 土讃線（多度津～高知）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-dosan-kochi-kubokawa` JR四国 土讃線（高知～窪川）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-tokushima-line` JR四国 徳島線（佐古～佃）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `jrs-naruto-line` JR四国 鳴門線（池谷～鳴門）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=possibility
- `jrs-muge-line` JR四国 牟岐線（阿南～阿波海南駅間）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=possibility
- `jrs-yodo-line` JR四国 予土線（北宇和島～若井）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の個別課題と解決に向けた方向性」の表（P.71～72）。pdftotext -layout で左列の路線名と各行の文を突き合わせて対応を確認した｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=possibility
- `jrs-yodo-muge-noon` JR四国 予土線・牟岐線（昼時間帯の利用）｜https://www.jr-shikoku.co.jp/04_company/jigyou/soukatsu_kensyou_zenryou.pdf｜資料の日付 2026-03｜原文の場所：総括検証「各線区の現状・課題やポテンシャル」の表（P.72）。行末の「（予土、牟岐）」まで引用に含めた｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=fact
- `shk-matsuyama-airport` 松山空港｜https://www.pref.ehime.jp/uploaded/attachment/142498.pdf｜資料の日付 2025-03｜原文の場所：1 はじめに（本文の後半）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `shk-honshi-toll` 本州四国連絡道路（瀬戸大橋・しまなみ海道・大鳴門橋などの本四道路）｜https://www.mlit.go.jp/policy/shingikai/content/001705757.pdf｜資料の日付 2023-10-24｜原文の場所：スライド「2 料金改定後9年間の振り返り(1) 料金収入と管理費」。同じ文の後半に、実際の料金収入は計画より上振れしたとあるので言い換えに添えた｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `shk-honshi-maintenance` 本州四国連絡高速道路（本四高速道路の橋の保全）｜https://www.jb-honshi.co.jp/corp_index/company/plan/pdf/plan_b.pdf｜資料の日付 2025-04｜原文の場所：「3 効率化・省力化・省人化を目指した確実な維持・修繕」｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `shk-tosaden` とさでん交通の路面電車（高知県）｜https://www.pref.kochi.lg.jp/doc/2026060400251/file_contents/06_siryou3.pdf｜資料の日付 2026｜原文の場所：「路面電車のあり方検討会の方向性」主な検討事項の2。検討事項3に「とさでん交通」の名がある。人口減少の語は引用の段落に無い（indirect）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=fact
- `shk-kotoden` ことでん（高松琴平電気鉄道）｜https://www.pref.kagawa.lg.jp/documents/13423/1-10.pdf｜資料の日付 2026-09-29｜原文の場所：事前評価チェックシート「計画の目標」。資料の日付は用紙に印字された令和08年09月29日｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `shk-asa-dmv` 阿佐海岸鉄道（阿佐東線・DMV）｜https://www.pref.tokushima.lg.jp/file/attachment/572811.pdf｜資料の日付 2020-08-19｜原文の場所：需要予測の【既存利用者】の欄｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `shk-regional-rail` 四国の地域鉄道（いよてつ・とさでん・ことでん）｜https://wwwtb.mlit.go.jp/shikoku/content/000332116.pdf｜資料の日付 2024-03｜原文の場所：1 調査概要｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `shk-sea-routes` 四国の旅客航路・離島航路｜https://wwwtb.mlit.go.jp/shikoku/content/000301634.pdf｜資料の日付 2022-03｜原文の場所：1-1 業務目的｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `shk-okinoshima-visitors` 沖の島・鵜来島（高知県宿毛市の離島）｜https://www.mlit.go.jp/kokudoseisaku/chirit/content/001619209.pdf｜資料の日付 2023-05｜原文の場所：沖の島・鵜来島の現状（産業・観光）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `shk-okinoshima-bearers` 沖の島・鵜来島（高知県宿毛市の離島）｜https://www.mlit.go.jp/kokudoseisaku/chirit/content/001619209.pdf｜資料の日付 2023-05｜原文の場所：沖の島・鵜来島の現状（人口・高齢化率）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `shk-matsuyama-transit` 松山市の地域公共交通（郊外部・中山間地域・島しょ部の路線）｜https://www.city.matsuyama.ehime.jp/shisei/machizukuri/compact_network/5kyougikai.files/gaiyou1.pdf｜資料の日付 2026｜原文の場所：1 計画の概要 計画策定の背景。「（案）」で「令和8（2026）年●月」の記載。確定前の版｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `shk-tokushima-port` 徳島小松島港｜https://www.pref.tokushima.lg.jp/file/attachment/1071435.pdf｜資料の日付 2026-07-08｜原文の場所：第2章【課題・論点】物流・産業振興（スライド）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `shr-tajima-shrines` 但馬地域（兵庫県北部）の神社｜https://www.kobe-np.co.jp/news/sougou/202205/0015299611.shtml｜資料の日付 2022-05-14｜原文の場所：記事本文の1段落目。引用は2文を続けた（記事は文の後に「１人平均２５・４社を担当する計算だ」と続く）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `shr-religious-corp` 全国の宗教法人｜https://toyokeizai.net/articles/-/676570｜資料の日付 2023-06-29｜原文の場所：記事の冒頭。有料会員限定の記事で、読めた無料の範囲（冒頭3段落）だけを根拠にした。「35％」は、日本創成会議の推計で消滅の可能性が指摘された市区町村にある宗教法人の比率として石井氏が割り出した値、と記事が説明している｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `shr-miyajima` 宮島（広島県廿日市市。厳島神社のある島）｜https://www.city.hatsukaichi.hiroshima.jp/uploaded/attachment/36877.pdf｜資料の日付 2020-03｜原文の場所：目的と位置づけ。引用は2文を続けた｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `shr-kubokawa-shrines` 高知県旧窪川町（現四万十町の一部）の神社｜https://kaken.nii.ac.jp/ja/file/KAKENHI-PROJECT-16K16705/16K16705seika.pdf｜資料の日付 2019-06-26｜原文の場所：研究成果の概要。2019年の資料。2020年以降の同種の調査は今回見つけられていない｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `wak-kumano` 熊野（和歌山県田辺市。世界文化遺産「熊野古道」など）｜https://www.chisou.go.jp/tiiki/kankyo/teian/2022sdgs_pdf/teian/31_tanabeshi.pdf｜資料の日付 2022｜原文の場所：「2030年のあるべき姿」欄｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `wak-kisei-shingu-shirahama` JR西日本 紀勢線（新宮～白浜）｜https://www.westjr.co.jp/press/article/2026/11/04/items/261104_00_press_yusoumitsudo.pdf｜資料の日付 2026-11-04｜原文の場所：別紙の表。pdftotext -layout で列見出し（営業キロ・収入・費用・収支率・営業係数・平均通過人員の1987年度／2025年度／比）と行を突き合わせた。同社和歌山支社の2026-03-09の資料にも新宮～白浜の1987年度の値4,123が見え、整合する｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=fact
- `wak-westjr-2000` JR西日本の輸送密度2,000人/日未満の線区（紀勢線 新宮～白浜を含む19路線32線区）｜https://www.westjr.co.jp/press/article/2026/11/04/items/261104_00_press_yusoumitsudo.pdf｜資料の日付 2026-11-04｜原文の場所：発表文の本文（表の前）。紀勢線 新宮～白浜は同じ発表の別紙の表に含まれる｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=possibility
- `wak-pref-transit` 和歌山県の地域公共交通｜https://www.pref.wakayama.lg.jp/prefg/020500/d00215116_d/fil/keikaku_gaiyou.pdf｜資料の日付 2024-02｜原文の場所：「本県の地域公共交通の課題」（1）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `wak-koya-shops` 高野山地域（和歌山県高野町）｜https://www.town.koya.wakayama.jp/img_data/2016/03/jinkou-bijyon.pdf｜資料の日付 2015-12｜原文の場所：2015年12月の資料。同じ段落の前に「集落によっては人口の減少により、集落の維持が困難になる」とある。2020年以降の高野町の資料（2022・2024）は取得したが、高野山の寺院や地区を名指しした同種の文は見つからなかった｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `thm-olc-risk` 東京ディズニーリゾート（運営：株式会社オリエンタルランド）｜https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100YCJX.pdf｜資料の日付 2026-06-25｜原文の場所：事業等のリスク「戦略リスク ① 主要マーケットの変化」。引用はその文の全体（句点の前まで）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `thm-olc-youth` 東京ディズニーリゾート（運営：株式会社オリエンタルランド）｜https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100YCJX.pdf｜資料の日付 2026-06-25｜原文の場所：経営環境の認識（インバウンド拡大の想定に続く文）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `thm-fujikyu-risk` 富士急ハイランドなどを運営する富士急行株式会社のレジャー・サービス事業｜https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100VYIY.pdf｜資料の日付 2025-06-17｜原文の場所：事業等のリスク（8）少子高齢化を伴う人口の減少と人手不足。同報告書に「富士急ハイランド」の語が30回出る｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `nat-jrhokkaido-2016` JR北海道（当社単独では維持することが困難な線区）｜https://www.jrhokkaido.co.jp/press/2016/161118-2.pdf｜資料の日付 2016-11-18｜原文の場所：2016年の資料。引用は表題と見出しにある語句。同じ発表の表には輸送密度200人未満の3線区（札沼線・根室線・留萌線）が出るが、表の抽出が崩れるため個別の項目にはしなかった｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=indirect／stance=possibility
- `nat-kururi` JR久留里線（久留里・上総亀山間）の沿線（千葉県上総地区）｜https://www.pref.chiba.lg.jp/koukei/press/2024/documents/kururi.pdf｜資料の日付 2024｜原文の場所：2 上総地区の交通に関する現状（1）人口動態。直後の文の将来見通しは脚注番号が挟まるため引用に入れていない｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `nat-sanrikutetsudo` 三陸鉄道の沿線（三陸沿岸地域）｜https://www.city.miyako.iwate.jp/material/files/group/8/sanntetsukoutuukeikaku2024.pdf｜資料の日付 2024｜原文の場所：第1章 計画の概要 1-1 計画策定の背景及び目的｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `nat-tsugaru-tetsudo` 津軽鉄道（青森県）｜https://www.pref.aomori.lg.jp/soshiki/kotsu/tetsudo/files/05-2shiryou3.pdf｜資料の日付 2026｜原文の場所：1 輸送人員（1）現状。資料に日付の記載は無く、令和7年度の出来事に触れているため2026年の資料と判断（年のみ）｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact
- `nat-oito-line` 大糸線（糸魚川・南小谷間）｜https://www.pref.nagano.lg.jp/kotsu/oitosen/documents/02_dai2siryou.pdf｜資料の日付 2026-06-01｜原文の場所：「第1回会議の主な発言」の箇条書き。この行には発言者（市町村名）の表記が付いていないので、発言者を特定せず「会議資料に記載」と言い換えた｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=possibility
- `nat-naru-maejima` 奈留島～前島航路（長崎県五島市）｜https://wwwtb.mlit.go.jp/shikoku/content/000301634.pdf｜資料の日付 2022-03｜原文の場所：事例紹介（奈留島～前島航路）。長崎県五島市の事例で、四国の資料に載っている｜言い換え：原文が述べる範囲に収めた（懸念・見込み・可能性の強さを変えていない）｜popLink=explicit／stance=fact

## 根拠なし・未調査（notFound 15 件）

- ユニバーサル・スタジオ・ジャパン：根拠なし（国内の人口減少・来場者減に運営側が言及した資料は、今回の検索では見つからなかった。運営会社の IR・公表資料そのものは開けていないので「ない」とは断定しない）（調べたこと：WebSearch（2026-11-07、運営会社の少子化・人口減少への言及）。運営会社ユー・エス・ジェイの公表資料に当たる検索結果は無し）
- 高知龍馬空港：根拠なし（取得した資料に該当の語は無かった）（調べたこと：高知県の高知龍馬空港・航空ネットワーク成長戦略検討会議の資料（議事要旨・アクションプラン総括・整備部会資料）を取得して人口減少・少子高齢化の語を検索）
- 高松空港：根拠なし（取得した資料に人口減少・少子高齢化の語は無かった）（調べたこと：高松空港株式会社の事業計画（2022・2023年度）・事業報告書・エアライン誘致等協議会資料を取得して検索）
- 徳島阿波おどり空港：根拠なし（取得した資料に人口減少・少子高齢化の語は無かった）（調べたこと：徳島阿波おどり空港将来ビジョン（令和8年3月）と検討会議の議事概要を取得して検索）
- 瀬戸大橋・しまなみ海道・大鳴門橋（個別の橋）：個別の橋について人口減少と結びつけた文は見つからなかった（本四道路全体の料金収入の見込みと保全業務の文だけ。別項目）（調べたこと：JB本四高速の中期経営計画・インフラ長寿命化計画（大鳴門橋、令和3年）・国への説明資料）
- 伊勢神宮：未調査（根拠なしと断定しない）（調べたこと：今回の調べでは資料を取得して確認していない）
- 出雲大社：根拠なし（出雲市の観光計画は人口減少の中の観光振興の意義を述べるが、出雲大社を名指しして維持の困難を述べた文は無かった）（調べたこと：出雲市の観光基本計画の骨子・観光財源検討委員会の資料を取得して検索）
- 厳島神社：神社そのものについての文は見つからなかった（宮島地域について人口減少と伝統の消失を述べた文は別項目）（調べたこと：廿日市市の宮島まちづくり基本構想・第3期まち・ひと・しごと創生推進計画を取得して検索）
- 伏見稲荷大社：未調査（根拠なしと断定しない）（調べたこと：今回の調べでは資料を取得して確認していない）
- 清水寺：未調査（根拠なしと断定しない）（調べたこと：今回の調べでは資料を取得して確認していない）
- 東大寺：未調査（根拠なしと断定しない）（調べたこと：今回の調べでは資料を取得して確認していない）
- 金刀比羅宮：根拠なし（琴平町の総人口の減少を述べた文はあるが、金刀比羅宮を名指しして維持の困難を述べた文は無かった）（調べたこと：琴平町の第3期まち・ひと・しごと創生総合戦略推進計画（内閣府の地域再生計画）と、琴平町の内閣府「伴走支援」報告資料を取得して検索）
- 高野山 金剛峯寺：寺院そのものについての文は見つからなかった（高野山地域の利便性低下の恐れを述べた文は別項目で、2015年の資料）（調べたこと：高野町の人口ビジョン（2015）・総合戦略・高齢者福祉計画（2024）・公共施設等総合管理計画（2022）を取得して検索）
- 熊野本宮大社：神社そのものについての文は見つからなかった（熊野全体の継承の困難を述べた文は別項目）（調べたこと：田辺市のSDGs未来都市の提案（2022））
- 南海電鉄 加太線・貴志川線（和歌山電鐵）：未調査（南海電鉄・和歌山電鐵の最新の公表資料は開いていない）（調べたこと：和歌山電鐵貴志川線の国の事例集（過去の存続の経緯）を取得したが、現在の見通しを述べた資料は開いていない）

## 注意が要る点

- 2020 年より前の資料を使った項目が 3 件ある：`shr-kubokawa-shrines`（2019、research 報告書）、`wak-koya-shops`（2015、高野町人口ビジョン）、`nat-jrhokkaido-2016`（2016）。いずれも言い換えの先頭に「（20XX年の資料）」と書いた。新しい資料を探しきれていない。
- 神社・寺院そのものではなく、地域や全体についての文：`shr-miyajima`（宮島地域）、`wak-kumano`（熊野全体）、`shr-religious-corp`（宗教法人全体）。画面では「厳島神社が〜」「熊野本宮大社が〜」とは言えない。
- `popLink` が indirect の 9 件は、利用者減・赤字・見直しの検討は述べているが、引用の文は人口減少と結びつけていない。画面で「人口が減ると」と言ってよいのは explicit の 35 件。
- `shk-honshi-toll` は「減少する計画」と述べつつ、実績は計画より上振れしたとも書いている。言い換えにも添えた。
- `nat-oito-line` は会議資料の発言整理の 1 行。当事者の公式な見解ではない。
- `shk-matsuyama-transit` は確定前の「案」の概要版。`nat-tsugaru-tetsudo`・`shk-tosaden`・`shk-matsuyama-transit` の日付は年のみ（資料に日付の記載が無いため）。
- `stance`：数字や起きていることを述べた文は fact、懸念・見込み・見直しの検討は possibility と私が判断した。数字を含まない現状の記述（例：`shk-sea-routes`）も fact にしてある。
- JSON に仕様に無い項目 `popLink`（explicit／indirect）を足した。無視してもアプリは動く。
- 調査担当エージェント 5 本（四国の鉄道・四国の空港と橋・神社寺院・テーマパークと和歌山・全国）は候補ファイルを書かないまま止まり、完了の通知も来なかった。取得済みの 213 ページ分の本文（`rt.py` のキャッシュ）を私が読み直して拾い、上の照合は私が取り直した。そのため、調べた範囲は取得済みの資料に偏る（伊勢神宮・伏見稲荷大社・清水寺・東大寺・南海電鉄は未調査）。
