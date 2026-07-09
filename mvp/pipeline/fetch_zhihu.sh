#!/usr/bin/env bash
# 从知乎数据开放平台拉取买车决策相关内容，原样存入 data/raw/
# 用法: ZHIHU_ACCESS_SECRET=xxx ./fetch_zhihu.sh
# 接口文档: https://developer.zhihu.com/docs
set -euo pipefail

if [[ -z "${ZHIHU_ACCESS_SECRET:-}" ]]; then
  echo "缺少环境变量 ZHIHU_ACCESS_SECRET" >&2
  exit 1
fi

RAW_DIR="$(cd "$(dirname "$0")/../data/raw" && pwd)"
BASE="https://developer.zhihu.com/api/v1/content"

queries=(
  "奔驰还是宝马怎么选"
  "BBA入门级值不值得买"
  "SUV还是轿车怎么选"
  "电车还是油车"
  "第一辆车买新车还是二手车"
  "国产新势力还是合资车"
  "30万落地买什么车"
  "混动还是纯电怎么选"
  "买车全款还是贷款"
  "人生第一辆车怎么选"
  "沃尔沃安全性值得买吗"
  "买车最后悔的配置"
)

i=0
for q in "${queries[@]}"; do
  i=$((i+1))
  out="$RAW_DIR/search_$(printf '%02d' "$i").json"
  echo "[$i/${#queries[@]}] zhihu_search: $q"
  curl -sG "$BASE/zhihu_search" \
    --data-urlencode "Query=$q" \
    -d 'Count=10' \
    -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
    -H "X-Request-Timestamp: $(date +%s)" \
    -H 'Content-Type: application/json' \
    --max-time 30 |
    python3 -c "import json,sys; d=json.load(sys.stdin); d['_query']='$q'; print(json.dumps(d, ensure_ascii=False, indent=2))" > "$out"
  sleep 1
done

echo "hot_list"
curl -s "$BASE/hot_list?Limit=30" \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)" \
  --max-time 30 |
  python3 -m json.tool --no-ensure-ascii > "$RAW_DIR/hot_list.json"

echo "done -> $RAW_DIR"
