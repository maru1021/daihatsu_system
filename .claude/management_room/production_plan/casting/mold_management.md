# 金型管理

## 型数: 1→2→3→4→5→6→メンテ→1

- 保存: `current + 1`
- 引継: そのまま使用
- DB: 1～6のみ

## UsableMold

- `end_of_month=true`: 月末取付中、同設備のみ、非表示
- `end_of_month=false`: 月内途中外し、全設備可、リスト表示

## 型替え時間（前品番の最終直）

- 6直目: メンテ
- 品番変更（1～5）: `previous_plan.changeover_time += CHANGEOVER_TIME`
