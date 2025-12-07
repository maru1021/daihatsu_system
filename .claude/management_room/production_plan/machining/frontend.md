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

## 初期割り振り（定時分保証）

**機能**: 出庫数を夜勤・日勤に割り振る際、定時分を最低保証

**残業上限**:
- 夜勤: 60分
- 日勤: 120分

**割り振りロジック** (`allocateShipmentToProduction()`):

```javascript
// 定時分と最大生産可能台数を計算
regularNightProduction = (定時450分 - 停止時間) / タクト * 稼働率
regularDayProduction = (定時455分 - 停止時間) / タクト * 稼働率
maxNightProduction = (定時450分 - 停止時間 + 60分) / タクト * 稼働率
maxDayProduction = (定時455分 - 停止時間 + 120分) / タクト * 稼働率

// 夜勤の割り振り
if (totalShipment < regularNightProduction) {
    夜勤 = regularNightProduction  // 定時分を最低保証
} else if (totalShipment <= maxNightProduction) {
    夜勤 = totalShipment
} else {
    夜勤 = maxNightProduction  // 上限
}

// 日勤の割り振り
if (totalShipment < regularDayProduction) {
    日勤 = regularDayProduction  // 定時分を最低保証
} else {
    日勤 = min(totalShipment + nightOverflow, maxDayProduction)
}
```

**例**: 出庫数100台、夜勤定時150台、日勤定時152台
- 夜勤: 150台（定時分）
- 日勤: 152台（定時分）

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

## 残業時間変更時の生産数計算

**問題**: 定時以下の生産数で残業時間を増やすと、その時点の生産数に残業分が加算され、時間と生産数に矛盾が発生

**解決策**: 定時分を最低保証してから残業分を加算 (`calculateProductionQuantity()`)

```javascript
// 定時分の生産数を計算
regularQuantity = (定時 - 停止) / タクト * 稼働率
regularItemQuantity = regularQuantity * 品番比率

if (残業 > 0) {
    // 全品番の現在生産数合計を取得
    totalCurrentProduction = 全品番の生産数合計

    if (totalCurrentProduction < regularQuantity) {
        // 定時分より少ない場合: 定時分 + 残業分
        overtimeItemQuantity = (残業 / タクト * 稼働率) * 品番比率
        return regularItemQuantity + overtimeItemQuantity
    } else {
        // 定時分以上の場合: 現在値 + 残業分
        return currentProduction + overtimeItemQuantity
    }
}
```

**例**: 生産数100台（定時300分相当）、残業60分追加
1. 定時455分相当の生産数 = 150台
2. 現在100台 < 定時150台 → 定時分に修正
3. 残業60分 ÷ タクト × 稼働率 = 20台
4. 結果: 150台 + 20台 = **170台**

## 週末休出時の定時分初期値

**機能**: 組付で休出があり、加工データがない場合、定時分を初期値として設定 (`setWeekendRegularTimeProduction()`)

```javascript
// 日勤定時分を計算
regularDayProduction = (455分 - 停止) / タクト * 稼働率

// 出庫数の比率で配分
if (totalShipment > 0) {
    各品番 = regularDayProduction * (品番出庫数 / 総出庫数)
} else {
    各品番 = regularDayProduction / 品番数  // 均等割り
}
```

**例**: 出庫数A=60台、B=40台、定時分150台
- A: 150 × (60/100) = 90台
- B: 150 × (40/100) = 60台

## 定時未満のハイライト

**機能**: 生産数・残業・計画停止から使用時間を計算し、定時未満の直を黄色表示 (`highlightUnderRegularTimeColumns()`)

```javascript
// 使用時間を計算
requiredProductionTime = (生産数 × タクト) / 稼働率
usedTime = requiredProductionTime + 計画停止

// 定時未満を判定
if (usedTime < 定時) {
    // 該当する直の全品番inputを黄色でハイライト
    productionInput.style.backgroundColor = '#fef9c3'
}
```

**トリガー**:
- 生産数入力時
- 残業時間・計画停止入力時
- 初期表示時

## テーブル別設定

```javascript
const linesItemData = [
    { tact: 0.5, yield_rate: 0.997 },  // #1
    { tact: 0.6, yield_rate: 0.995 }   // #2
];
```
