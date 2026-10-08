# 郵便番号ごとの「市区町村名・町名・代表地点（緯度経度）」を、上3桁ごとの JSON に書き出す
# 使い方: python3 -I build_towns.py <yubinbango data dir> <Geolonia latest.csv> <出力dir>
#   yubinbango data: https://github.com/yubinbango/yubinbango-data （日本郵便の郵便番号データ）
#   Geolonia latest.csv: https://geolonia.github.io/japanese-addresses/latest.csv （CC BY 4.0）
# 出力: <出力dir>/231.json = {"c": ["横浜市中区", ...], "z": {"0017": [市区町村番号, "港町", 緯度, 経度], ...},
#                                "b": [事業所・私書箱用の番号の下4桁, ...]}
import csv
import glob
import json
import os
import re
import sys
from collections import defaultdict

src_dir, geo_csv, out_dir = sys.argv[1:4]

PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
         '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
         '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
         '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
         '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']


KANJI_DIGITS = '〇一二三四五六七八九'


def to_kanji(m):
    """「１３」→「十三」のように、町名中の数字を漢数字にする（位置データ側は漢数字のため）"""
    n = int(m.group(0))
    if n >= 100:
        return m.group(0)
    tens, ones = divmod(n, 10)
    return (('' if tens == 1 else KANJI_DIGITS[tens]) + '十' if tens else '') + (KANJI_DIGITS[ones] if ones or not tens else '')


def norm(s):
    """表記ゆれをそろえる（ヶ/ケ、旧字体、全角数字・算用数字など）"""
    s = s.translate(str.maketrans({'ヶ': 'ケ', 'ヵ': 'カ', '檮': '梼', '惠': '恵', '　': '', ' ': ''}))
    s = s.translate(str.maketrans('０１２３４５６７８９', '0123456789'))
    return re.sub(r'[0-9]+', to_kanji, s)


def clean_town(t):
    """郵便番号データの町名から、括弧書き（「（次のビルを除く）」など）や丁目の範囲を外す"""
    t = re.sub(r'（.*$', '', t)
    t = re.sub(r'\(.*$', '', t)
    return norm(t)


CHOME = re.compile(r'[一二三四五六七八九十]+丁目$')


def town_key(n):
    """比較用の町名。先頭の「大字」「字」を外す"""
    return re.sub(r'^(大字|字)', '', n)


class City:
    """1つの市区町村の町丁目一覧。町名 → 代表点 を何通りかの方法で引けるようにしておく"""

    def __init__(self):
        self.exact = defaultdict(list)   # 町丁目名そのまま（港町一丁目）
        self.base = defaultdict(list)    # 丁目を外した町名（港町）→ 各丁目の点
        self.koaza = defaultdict(list)   # 小字名、大字＋小字名

    def add(self, town, koaza, lat, lng):
        t = town_key(town)
        if koaza:
            self.koaza[koaza].append((lat, lng))
            self.koaza[t + koaza].append((lat, lng))
        else:
            self.exact[t].append((lat, lng))
            self.base[CHOME.sub('', t)].append((lat, lng))

    def locate(self, town):
        if not town:
            return None
        t = town_key(town)
        for table in (self.exact, self.base, self.koaza):
            if t in table:
                return table[t]
        # 「西新宿新宿パークタワー１６階」「細江町気賀」のように後ろに建物名や地区名が続く町名は、
        # 先頭が一致するいちばん長い町名で代用する（2文字以上）
        best = max((b for b in self.base if len(b) >= 2 and t.startswith(b)), key=len, default=None)
        return self.base[best] if best else None


# Geolonia: (都道府県, 市区町村) → City
geo = defaultdict(City)
with open(geo_csv, encoding='utf-8') as f:
    for row in csv.DictReader(f):
        if not row['緯度']:
            continue  # 位置のない行は飛ばす
        geo[(row['都道府県名'], norm(row['市区町村名']))].add(
            norm(row['大字町丁目名']), norm(row['小字・通称名']), float(row['緯度']), float(row['経度']))


city_cache = {}


def find_city(pref, city):
    key = (pref, city)
    if key in city_cache:
        return city_cache[key]
    c = norm(city)
    found = geo.get((pref, c))
    if not found:
        # 「西多摩郡瑞穂町」と「瑞穂町」のような郡名の有無、「三宅島三宅村」のような島名の有無
        for (p, gc), towns in geo.items():
            if p == pref and (c.endswith(gc) or gc.endswith(c)):
                found = towns
                break
    if not found and '市' in c:
        # 区の再編（浜松市中央区など）で位置データ側の区名が古い場合は、同じ市の全区をまとめて探す
        base = c[:c.index('市') + 1]
        merged = City()
        for (p, gc), towns in geo.items():
            if p == pref and gc.startswith(base) and gc != base:
                for name in ('exact', 'base', 'koaza'):
                    for k, v in getattr(towns, name).items():
                        getattr(merged, name)[k].extend(v)
        found = merged if merged.exact else None
    city_cache[key] = found
    return found


files = defaultdict(lambda: {'c': [], 'z': {}, 'b': []})
stats = defaultdict(int)
for path in sorted(glob.glob(os.path.join(src_dir, '*.js'))):
    text = open(path, encoding='utf-8').read()
    data = json.loads(re.search(r'\$yubin\((.*)\)', text, re.S).group(1))
    for zipcode, row in data.items():
        pref = PREFS[int(row[0]) - 1]
        city, town = row[1], row[2]
        t = clean_town(town)
        found = find_city(pref, city)
        pts = found.locate(t) if found else None
        out = files[zipcode[:3]]
        if city not in out['c']:
            out['c'].append(city)
        entry = [out['c'].index(city), town]
        if pts:
            entry += [round(sum(p[0] for p in pts) / len(pts), 4), round(sum(p[1] for p in pts) / len(pts), 4)]
            stats['位置あり'] += 1
        elif not t:
            stats['町名なし（市区町村のみ）'] += 1
        else:
            stats['位置なし'] += 1
        out['z'][zipcode[3:]] = entry
        if len(row) >= 4:  # 4項目目（番地・事業所名など）があるのは事業所・私書箱用の番号
            out['b'].append(zipcode[3:])

os.makedirs(out_dir, exist_ok=True)
total_size = 0
for head, d in files.items():
    p = os.path.join(out_dir, head + '.json')
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    total_size += os.path.getsize(p)
print(dict(stats), 'ファイル数', len(files), '合計サイズ', total_size)
