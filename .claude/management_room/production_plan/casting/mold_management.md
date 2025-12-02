# 金型管理

## 型数サイクル: 1→2→3→4→5→6→メンテ→1

```python
saved_count = current_shift_count + 1  # 保存: 使用後+1
next_shift_count = saved_count  # 引継: そのまま使用
```

- 型数0: 一時状態のみ / DB: 1～6 / 6後: 型替え必須

## UsableMold

- `end_of_month=true`: 月末設備取付中、同設備のみ継続、非表示
- `end_of_month=false`: 月内途中外し、全設備可、リスト表示

## 型替え時間（前品番の最終直に設定）

```python
# 6直目: メンテ
if shift_count == 6:
    plan.changeover_time = CHANGEOVER_TIME
    machine_shift_count[machine_id] = 0

# 品番変更: 型数1～5
if item_changed and shift_count < 6:
    previous_plan.changeover_time += CHANGEOVER_TIME
    detached_molds[old_item].append(shift_count)
```

ref: `auto_casting_production_plan.py:207, 794`
