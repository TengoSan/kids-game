# 郵便番号データ（yubinbango-data）を、地図の市区町村コードごとの郵便番号一覧に変換する
# 使い方: python3 -I build_zipindex.py <yubinbango data dir> <municipalities.json> <出力json>
import glob
import json
import os
import re
import sys
from collections import defaultdict

src_dir, topo_path, out_path = sys.argv[1:4]

topo = json.load(open(topo_path, encoding='utf-8'))
geoms = list(topo['objects'].values())[0]['geometries']
PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
         '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
         '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
         '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
         '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']

munis = []  # (pref, fullName, N03_003, N03_004, code)
for g in geoms:
    p = g['properties']
    munis.append((p['N03_001'], (p['N03_003'] or '') + (p['N03_004'] or ''), p['N03_003'], p['N03_004'], p['N03_007']))


VARIANTS = str.maketrans({'檮': '梼', '惠': '恵'})  # 郵便番号データと地図データで字体が違う漢字


def match(pref, city):
    """app.js の findMunicipalities と同じ考え方で、住所の市区町村名 → 地図のコード一覧"""
    in_pref = [m for m in munis if m[0] == pref]
    city = city.translate(VARIANTS)
    exact = {m[4] for m in in_pref if m[1] == city or m[3] == city}
    if exact:
        return exact, False
    # 「三宅島三宅村」のように前に島名などが付く場合は、末尾の町村名で1つに決まれば採用
    tail = {m[4] for m in in_pref if m[3] and city.endswith(m[3])}
    if len(tail) == 1:
        return tail, False
    # 区の再編など地図データより新しい名前 → 政令市全体
    approx = {m[4] for m in in_pref if m[2] and m[2].endswith('市') and city.startswith(m[2])}
    return approx, True


index = defaultdict(lambda: defaultdict(list))  # code -> 上3桁 -> 下4桁のリスト
cache = {}
unmatched = defaultdict(int)
approx_names = set()
total = 0
for path in sorted(glob.glob(os.path.join(src_dir, '*.js'))):
    text = open(path, encoding='utf-8').read()
    data = json.loads(re.search(r'\$yubin\((.*)\)', text, re.S).group(1))
    for zipcode, row in data.items():
        total += 1
        pref = PREFS[int(row[0]) - 1]
        city = row[1]
        key = (pref, city)
        if key not in cache:
            cache[key] = match(pref, city)
        codes, approx = cache[key]
        if not codes:
            unmatched[key] += 1
            continue
        if approx:
            approx_names.add(key)
        # 事業所・私書箱用の番号（4項目目に事業所名などがある）は所在地が別の県のこともあるので
        # 「*」付きのグループに分け、7桁ぴったりの検索でだけ使う
        head = ('*' if len(row) >= 4 else '') + zipcode[:3]
        for c in codes:
            index[c][head].append(zipcode[3:])

out = {c: {p3: ' '.join(sorted(v)) for p3, v in sorted(d.items())} for c, d in sorted(index.items())}
json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

print('郵便番号の総数:', total)
print('地図の市区町村に対応できた市区町村コード数:', len(out), '/ 地図側', len({m[4] for m in munis}))
print('政令市全体で代用:', sorted(approx_names))
print('対応できなかった名前:', dict(unmatched))
print('出力サイズ:', os.path.getsize(out_path))
