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

## 初期割り振り（残業上限考慮）

**機能**: 出庫数を夜勤・日勤に割り振る際、各シフトの残業上限を考慮

**残業上限**:
- 夜勤: 60分
- 日勤: 120分

**割り振りロジック** (`allocateShipmentToProduction()`):

```javascript
// 夜勤・日勤で生産可能な最大台数を計算
maxNightProduction = (定時450分 - 停止時間 + 60分) / タクト * 稼働率
maxDayProduction = (定時455分 - 停止時間 + 120分) / タクト * 稼働率

// ケース1: 出庫数が夜勤上限内
if (totalShipment <= maxNightProduction) {
    夜勤 = 出庫数全体
    日勤 = 出庫数全体
}
// ケース2: 出庫数が夜勤上限超過
else {
    夜勤 = maxNightProduction  // 60分残業上限
    日勤 = 出庫数全体 + (出庫数 - maxNightProduction)  // 溢れ分を追加
}
```

**例**: 出庫数100台、夜勤上限80台、日勤上限150台
- 夜勤: 80台
- 日勤: 100 + (100-80) = 120台

**コンロッドライン**: 別ロジック（出庫数3倍、比率配分）でスキップ

## 残業時間の初期計算

**処理順**:
1. `allocateShipmentToProduction()` - 生産数を割り振り
2. `calculateInitialOvertimes()` - 生産数から残業時間を逆算

**計算式**:
```javascript
定時生産可能台数 = (定時時間 - 停止時間) / タクト * 稼働率
追加生産数 = 生産数合計 - 定時生産可能台数
残業時間 = ceil((追加生産数 * タクト) / 稼働率 / 5) * 5  // 5分刻み
```

## テーブル別設定

```javascript
const linesItemData = [
    { tact: 0.5, yield_rate: 0.997 },  // #1
    { tact: 0.6, yield_rate: 0.995 }   // #2
];
```
