#!/bin/bash
# e-Stat「国勢調査2020 町丁・字等別境界データ」（都道府県ごとの zip）から、
# 市区町村ごとの町丁目境界 TopoJSON（data/shapes/市区町村コード.json）を作る
# 使い方: bash build_town_shapes.sh <zipを置いたdir（01.zip〜47.zip）> <作業dir> <出力dir> <mapshaperのパス>
#   zip の入手先（都道府県コード NN）:
#   https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=NN&coordSys=1&format=shape&downloadType=5&datum=2011
set -e
ZIP_DIR="$1"; WORK="$2"; OUT="$3"; MS="$4"
mkdir -p "$WORK" "$OUT"
for i in $(seq 1 47); do
  code=$(printf "%02d" "$i")
  rm -rf "$WORK/$code" && mkdir -p "$WORK/$code"
  unzip -o -q "$ZIP_DIR/$code.zip" -d "$WORK/$code"
  # HCODE 8101 = 通常の区画（8154 の水面は除く）
  # 同じ町名の区画（飛び地など）は1つにまとめ、境界を 8% まで簡略化して、市区町村ごとのファイルに分ける
  "$MS" -i "$WORK/$code"/*.shp encoding=shiftjis \
    -filter 'HCODE == 8101' \
    -each 'M = PREF + CITY, N = S_NAME' \
    -dissolve2 'M,N' \
    -simplify 8% keep-shapes \
    -split M \
    -filter-fields N \
    -o format=topojson quantization=100000 singles "$OUT" 2>&1 | grep -v '^\[o\] Wrote' || true
  echo "prefecture $code done"
done
