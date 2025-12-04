# クイックリファレンス

## JS頻出

```javascript
// 在庫: 小数累積→表示時整数化
calculatedStock += production * yieldRate - shipment;
input.value = Math.floor(calculatedStock);

// 定時・休出: チェックセル判定優先→残業入力確認は後
if (shift === 'day' && (isRegularHours || isHolidayWork)) {
    if (additionalProduction > 0) return false;
}

// 鋳造: 中子=24の倍数
const coreCount = Math.round(productionValue / 24) * 24;

// 鋳造: ライン別定時時間
if (isHeadLine) {
    REGULAR_TIME_DAY = 490;   // ヘッド: 日490分
    REGULAR_TIME_NIGHT = 485; // ヘッド: 夜485分
} else {
    REGULAR_TIME_DAY = 455;   // ブロック・カバー: 日455分
    REGULAR_TIME_NIGHT = 450; // ブロック・カバー: 夜450分
}

// 鋳造: 金型管理（ヘッドのみ）
if (!isHeadLine) return; // ブロック・カバーはスキップ

// コンロッド: 出庫数から比率→残業時間で生産数算出
const totalProducibleQuantity = Math.ceil((regularTime + overtime - stopTime) / tact * occupancyRate);
const productionQty = Math.round(totalProducibleQuantity * (shipmentValue / totalShipment));
```

## Python頻出

```python
# 前月末在庫
.order_by('-id').first()

# 出庫数: 上位工程から計算（DBに保存しない）
# 鋳造: 加工生産数の合計
# 加工: 組付け生産数の合計（複数ラインは残業均等化で振り分け）
# コンロッド: 組付け生産数×3（外注分を考慮）
if line_name == 'コンロッド' and allocated_qty is not None:
    allocated_qty = allocated_qty * 3
```

## エラー対処

| エラー | 解決 |
|--------|------|
| 在庫-1 | 小数累積 |
| 全品番表示 | line_data.item_names |
| 前月末不正 | order_by('-id') |
| コンロッド初期値 | [conrod_special_handling.md](management_room/production_plan/machining/conrod_special_handling.md) |
