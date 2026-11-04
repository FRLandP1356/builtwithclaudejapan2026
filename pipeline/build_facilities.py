"""Build public/data/facilities.json: the population sizes at which service facilities are present.

The values are transcribed by hand from the chart on page 3 of the MLIT document
https://www.mlit.go.jp/common/001042019.pdf (slide titled "サービス施設の立地する確率が50％及び80％となる
自治体の人口規模（三大都市圏を除く）"). The chart gives, for each facility type, the municipal population
size at which the share of municipalities with at least one such facility first exceeds 50% (left end of
the bar, p50) and 80% (right end, p80). Values are class midpoints, e.g. a first crossing inside the
0-1,000 class is printed as 500. Where the chart draws a single dot, both ends coincide (p50 == p80).

The chart's text layer is unreliable, so every value was read from the rendered page image and then
checked against the extracted text. The statistics exclude the three major metropolitan areas.

    python3 -m pipeline.build_facilities     # rewrite public/data/facilities.json
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "public", "data", "facilities.json")

SOURCE = (
    "国土交通省国土政策局「サービス施設の立地する確率が50％及び80％となる自治体の人口規模（三大都市圏を除く）」"
    "（都市圏参考資料、https://www.mlit.go.jp/common/001042019.pdf の3ページ）。"
    "2009〜2012年の統計。三大都市圏を除く自治体が対象"
)

# (id, name exactly as printed in the chart, p50, p80, essential), in the chart's top-to-bottom order.
# Single-dot rows repeat the value for p80.
_ROWS: List[Tuple[str, str, int, int, bool]] = [
    # 小売
    ("grocery", "飲食料品小売業", 500, 500, True),
    ("stationery_books", "書籍・文房具小売業", 1500, 2500, False),
    ("mens_clothing", "男子服小売業", 9500, 22500, False),
    ("pet_supplies", "ペット・ペット用品小売業", 32500, 47500, False),
    ("import_car_dealer", "外車ディーラー3大ブランド", 175000, 225000, False),
    ("shopping_center", "ショッピングセンター（売場面積15,000㎡以上）", 77500, 92500, False),
    ("department_store", "百貨店", 275000, 275000, False),
    # 宿泊・飲食サービス
    ("restaurant", "飲食店", 500, 500, False),
    ("cafe", "喫茶店", 2500, 7500, False),
    ("bar", "酒場、ビアホール", 500, 4500, False),
    ("hotel", "旅館、ホテル", 500, 500, False),
    ("hamburger_shop", "ハンバーガー店", 32500, 52500, False),
    ("starbucks", "スターバックスコーヒー", 175000, 275000, False),
    # 生活関連サービス
    ("arcade", "遊戯場", 5500, 17500, False),
    ("karaoke", "カラオケボックス業", 17500, 37500, False),
    ("performance_venue", "興行場、興行団", 72500, 175000, False),
    ("wedding_hall", "結婚式場業", 57500, 82500, False),
    ("media_rental", "音楽・映像記録物賃貸業", 27500, 47500, False),
    ("fitness_club", "フィットネスクラブ", 42500, 62500, False),
    ("cinema", "映画館", 87500, 175000, False),
    # 金融
    ("post_office", "郵便局", 500, 500, True),
    ("bank", "銀行（中央銀行を除く）", 6500, 9500, True),
    ("securities", "金融商品取引業", 52500, 87500, False),
    # 学術研究、教育・学習支援
    ("cram_school", "学習塾", 5500, 6500, False),
    ("music_lessons", "音楽教授業", 4500, 17500, False),
    ("language_lessons", "外国語教授業", 27500, 32500, False),
    ("museum", "博物館、美術館", 57500, 87500, False),
    ("research_institute", "学術・開発研究機関", 32500, 77500, False),
    ("university", "大学", 125000, 175000, False),
    # 医療・福祉
    ("clinic", "一般診療所", 500, 500, True),
    ("dental_clinic", "歯科診療所", 500, 2500, False),
    ("nursing_home", "介護老人福祉施設", 500, 4500, True),
    ("general_hospital", "一般病院", 5500, 27500, True),
    ("day_care", "通所・短期入所介護事業", 6500, 9500, True),
    ("home_help", "訪問介護事業", 8500, 27500, True),
    ("emergency_hospital", "救急告示病院", 17500, 37500, False),
    ("regional_support_hospital", "地域医療支援病院", 97500, 225000, False),
    ("critical_care_center", "救命救急センター施設", 175000, 275000, False),
    ("advanced_hospital", "先進医療を実施する病院", 225000, 375000, False),
    ("care_health_facility", "介護老人保健施設", 9500, 22500, False),
    ("long_term_care_hospital", "介護療養型医療施設", 32500, 62500, False),
    ("paid_nursing_home", "有料老人ホーム", 42500, 125000, False),
    # 対企業サービス
    ("car_rental", "自動車賃貸業", 22500, 52500, False),
    ("internet_services", "インターネット付随サービス業", 47500, 87500, False),
    ("tax_accountant", "税理士事務所", 17500, 27500, False),
    ("cpa_office", "公認会計士事務所", 87500, 275000, False),
    ("law_office", "法律事務所", 57500, 77500, False),
    ("consulting", "経営コンサルタント業", 37500, 62500, False),
]


def build() -> List[Dict[str, Any]]:
    """Return the facility table as a list of dicts shaped like the `Facility` interface in src/engine/types.ts."""
    return [
        {
            "id": fid,
            "name": name,
            "p50": p50,
            "p80": p80,
            "essential": essential,
            "excludesMetro": True,
            "source": SOURCE,
        }
        for fid, name, p50, p80, essential in _ROWS
    ]


def write(path: str = OUT_PATH) -> int:
    """Write the table as compact UTF-8 JSON. Returns the number of facilities."""
    rows = build()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    return len(rows)


def main() -> int:
    count = write()
    print(f"wrote {count} facilities to {os.path.relpath(OUT_PATH, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
