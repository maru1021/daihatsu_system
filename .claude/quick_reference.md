# クイックリファレンス

## 頻出パターン

```javascript
// 在庫: 小数累積→表示時整数化
const goodProduction = production * yieldRate;
calculatedStock += goodProduction - shipment;
input.value = Math.floor(calculatedStock);
```

```python
# 前月末在庫: idソート
.order_by('-id').first()
```

```python
# 加工: 組付ラインと紐づかない場合の初期値設定
has_assembly_link = line.assembly is not None
if not has_assembly_link:
    # AssemblyItemMachiningItemMapから組付側の出庫数を取得
    assembly_shipment = sum(組付生産計画の生産数)
    # 生産数 = 出庫数
    assembly_production = assembly_shipment
    # 残業時間を計算
    overtime = calc_overtime(assembly_production, tact, occupancy_rate)
```

## エラー対処

| エラー | 解決 |
|--------|------|
| 在庫-1 | 小数累積 |
| 全品番表示 | line_data.item_names |
| 前月末不正 | order_by('-id') |
| 加工初期値なし | has_assembly_link判定→AssemblyItemMachiningItemMap |

詳細: [共通](management_room/production_plan/common/stock_management.md) / [鋳造](management_room/production_plan/casting/mold_management.md) / [加工](management_room/production_plan/machining/overview.md)
