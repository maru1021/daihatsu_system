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
# 加工: 出庫数と在庫数の扱い
# 出庫数: DBに保存せず、常に組付けから計算
#   GET: _get_shipment_for_item() で組付け生産数→出庫数
#   POST: shipment=None（保存しない）
# 在庫数: DBから読み込まず、フロントエンドで計算
#   GET: stock_map 使用せず
#   POST: 計算値を保存（翌月の前月末在庫として使用）

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
# 4. 生産数・出庫数の初期値設定
# 5. 残業時間を計算
```

## エラー対処

| エラー | 解決 |
|--------|------|
| 在庫-1 | 小数累積 |
| 全品番表示 | line_data.item_names |
| 前月末不正 | order_by('-id') |
| 加工初期値なし | has_assembly_link判定→AssemblyItemMachiningItemMap |
| 定時・休出で上限なし | 残業入力確認を遅延、定時・休出チェックを優先 |

詳細: [共通](management_room/production_plan/common/stock_management.md) / [鋳造](management_room/production_plan/casting/mold_management.md) / [加工](management_room/production_plan/machining/overview.md)
