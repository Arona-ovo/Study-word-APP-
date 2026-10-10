#!/usr/bin/env bash
# 全量跑一遍所有校验脚本
NODE="C:/Users/33156/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
cd "C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/_tools"
total=0
red=0
RED_LIST=""
for f in check-*.js; do
  total=$((total+1))
  out=$($NODE "$f" 2>&1)
  if [ $? -ne 0 ]; then
    red=$((red+1))
    RED_LIST="$RED_LIST\n### $f\n$out"
    echo "FAIL  $f"
  fi
done
echo ""
echo "================ 汇总 ================"
echo "共 $total 个脚本，失败 $red 个"
if [ -n "$RED_LIST" ]; then
  echo -e "$RED_LIST" | head -80
fi
