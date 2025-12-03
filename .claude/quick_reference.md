# クイックリファレンス

## 頻出パターン

```javascript
// 在庫: 小数累積→表示時整数化
const goodProduction = production * yieldRate;
calculatedStock += goodProduction - shipment;
input.value = Math.floor(calculatedStock);

// 定時・休出チェック: 残業入力確認を遅延
// 定時・休出時は残業入力が非表示のため、チェックセル判定より前に
// 存在確認するとearly returnしてしまう
const overtimeInput = getInputElement(...);  // 取得のみ
// 定時・休出チェック（日勤のみ）
if (shift === 'day' && (isRegularHours || isHolidayWork)) {
    if (additionalProduction > 0) return false;
    return true;
}
// 定時・休出でない場合のみ存在確認
if (!overtimeInput || overtimeInput.style.display === 'none') return true;
```

```python
# 前月末在庫: idソート
.order_by('-id').first()
```

```python
# 出庫数の扱い（上位工程からリアルタイム反映）
# 鋳造: 出庫数 = 加工生産数の合計（holding_out_countフィールドは削除済み）
# 加工: 出庫数 = 組付け生産数の合計（shipmentフィールドは使用しない）
# 在庫数: フロントエンドで計算、DBに保存（翌月の前月末在庫として使用）

# 加工の出庫数計算
has_multiple_lines = len(lines) > 1

# 1. 組付側出庫数を取得
assembly_shipment_map = get_assembly_shipment_data(...)

# 2. 複数ラインの場合、残業均等化で振り分け
if has_multiple_lines:
    # 品番を分類: 固定品番（1ラインのみ）vs 柔軟な品番（複数ライン）
    fixed_items, flexible_items = classify_items(...)

    # 固定品番を先に割り当て
    allocate_fixed_items(fixed_items)

    # 柔軟な品番を残業均等化で割り当て（1個ずつ貪欲法）
    allocate_flexible_items(flexible_items)

# 3. 出庫数を計算（_get_shipment_for_item）
# 4. 生産数はDBから取得（データがない場合は0）、出庫数は常に計算
# 5. 残業時間を計算
```

```javascript
// 鋳造: 中子計算（24の倍数に丸める）
const coreCount = Math.round(productionValue / 24) * 24;
// 例: 生産数50→中子48、生産数60→中子60

// 鋳造: 生産台数は読み取り専用（HTML: readonly属性）
<input type="number" class="production-input" readonly />
```

## Excel出力リファクタリング

```python
# 出庫数計算ロジックの共通化
def _calculate_delivery_from_machining(self, item_name, date, shift, ...):
    """加工生産計画から出庫数を計算（共通ヘルパー）"""
    delivery = 0
    for machining_item_info in casting_to_machining_map.get(item_name, []):
        for machining_plan in machining_plans_dict.get(key, []):
            delivery += machining_plan.production_quantity or 0
    return delivery

# 直別行書き込みの統合
def _write_casting_delivery_shift_rows(self, ws, ..., shift, shift_label, is_first_shift):
    """日勤・夜勤で共通のロジック（DRY原則）"""
    # shift='day'/'night', shift_label='日勤'/'夜勤'
    # is_first_shift=True: セクション名を出力
```

**メリット**: 重複コード削減（約80行→40行）、保守性向上、テスタビリティ向上

## エラー対処

| エラー | 解決 |
|--------|------|
| 在庫-1 | 小数累積 |
| 全品番表示 | line_data.item_names |
| 前月末不正 | order_by('-id') |
| 加工初期値なし | has_assembly_link判定→AssemblyItemMachiningItemMap |
| 定時・休出で上限なし | 残業入力確認を遅延、定時・休出チェックを優先 |

詳細: [共通](management_room/production_plan/common/stock_management.md) / [鋳造](management_room/production_plan/casting/mold_management.md) / [加工](management_room/production_plan/machining/overview.md)
