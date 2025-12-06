# 加工フロントエンド

## データ責務

| データ | 計算 | DB読 | DB保 |
|--------|------|------|------|
| 出庫数 | BE | × | × |
| 在庫数 | FE | × | ○ |
| 生産数 | FE | ○ | ○ |

## 生産数上限（定時・休出）

日勤で定時ONまたは休出の場合、残業不可のため生産数に上限あり。

**処理順**:
1. 残業入力確認を遅延（非表示のため）
2. 定時・休出チェック優先
3. 残業入力チェックは後で実行

```javascript
if (shift === 'day' && (isRegularHours || isHolidayWork)) {
    if (additionalProduction > 0) return false;  // 定時上限超過
}
```

## 在庫計算（良品率適用）

小数累積→表示時整数化

```javascript
let calculatedStock = previousMonthStocks[itemName] || 0;
// 各直
calculatedStock += production * yieldRate - shipment;
setValue(..., Math.floor(calculatedStock));
```

## 月計(直)計算（複数ライン対応）

**問題**: 複数のMachiningLineに同じ品番が存在する場合、夜勤行の取得で最初のテーブルの値を使用してしまう。

**解決策**: 日勤行の親テーブル内で夜勤行を検索し、同じライン内でペアリング。

```javascript
function updateDailyTotals() {
    // 各セクション（生産数、出庫数）
    sections.forEach(section => {
        document.querySelectorAll(`[data-section="${section}"][data-shift="day"]`).forEach(dayRow => {
            // 同じテーブル内の夜勤行を取得（重要！）
            const table = dayRow.closest('table');
            const nightRow = table.querySelector(`[data-section="${section}"][data-shift="night"][data-item="${itemName}"]`);

            // 日勤+夜勤の合計を計算
            const dailyTotal = calculateDayAndNightTotal(dayInputs, nightInputs);
        });
    });
}
```

**影響品番**: VE5（ヘッド#1/#2）、S系(VE4S)（ブロック#1/#2）など、複数ラインで生産される品番。

## テーブル別設定

```javascript
const linesItemData = [
    { tact: 0.5, yield_rate: 0.997 },  // #1
    { tact: 0.6, yield_rate: 0.995 }   // #2
];
```
