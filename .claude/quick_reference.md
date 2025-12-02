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

## エラー対処

| エラー | 解決 |
|--------|------|
| 在庫-1 | 小数累積 |
| 全品番表示 | line_data.item_names |
| 前月末不正 | order_by('-id') |

詳細: [共通](management_room/production_plan/common/stock_management.md) / [鋳造](management_room/production_plan/casting/mold_management.md) / [加工](management_room/production_plan/machining/overview.md)
