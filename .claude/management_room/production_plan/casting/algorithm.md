# 鋳造アルゴリズム

## 優先順位

1. 矢印最小化（6直連続）
2. 残個数均等化
3. 適正在庫維持

## 初期化

```python
for mold in previous_month_molds:
    if mold.end_of_month:
        machine_current_item[machine_id] = mold.item_name
        machine_shift_count[machine_id] = mold.used_count
    else:
        # DB値、次回使用時+1
        prev_detached_molds[item_name].append(mold.used_count + 1)

remaining = MOLD_CHANGE_THRESHOLD - machine_shift_count[machine_id]
next_changeover_timing[machine_id] = current_shift + remaining
```

ref: `auto_casting_production_plan.py:207, 794`

## イベント駆動ループ

```python
while current_shift <= total_shifts:
    target_machine = min(next_changeover_timing, key=next_changeover_timing.get)
    selected_item = find_most_urgent_item(target_machine, changeover_shift)
    mold_count = get_mold_count(target_machine, selected_item)
    remaining_shifts = MOLD_CHANGE_THRESHOLD - mold_count + 1

    for i in range(remaining_shifts):
        create_production_plan(...)
```

ref: `auto_casting_production_plan.py:979`

## 品番選定

```python
def can_assign_item_for_6_shifts(start_shift, machine_id, item_name):
    for i in range(6):
        if not can_assign_item(start_shift + i, machine_id, item_name):
            return False
    return True

# 1. 6直分禁止パターン違反なし
# 2. 在庫切れ早い順
# 3. 月末在庫最小
```

禁止パターン: `pair_limit`以上

```python
# prohibited_patterns['VE7_VET2'] = 3
VE7=1 + VET2=1 = 2  # OK
VE7=2 + VET2=1 = 3  # NG
```
