# 加工フロントエンド

## データ計算の責務

**重要**: 加工生産計画では、出庫数と在庫数はフロントエンドで計算されます。

| データ | 計算場所 | DB読み込み | DB保存 | 備考 |
|--------|---------|-----------|--------|------|
| 出庫数 | バックエンド | しない | しない | 組付けの生産数から計算 |
| 在庫数 | フロントエンド | しない | する | 翌月の前月末在庫として使用 |
| 生産数 | フロントエンド | する | する | ユーザー入力値 |

## 生産数（良品率含まず）

```javascript
生産数 = (定時 + 残業 - 計画停止) / タクト × 稼働率
```

## 生産数上限チェック（定時・休出）

**重要**: 定時ONまたは休出の日勤では、残業が不可のため生産数に上限があります。

### チェックロジック

```javascript
function recalculateOvertimeFromProduction(dateIndex, shift, itemName, lineIndex) {
    // 定時間で生産できる台数を計算
    const regularProductionTime = regularTime - stopTime;
    const regularTotalProduction = regularProductionTime > 0
        ? Math.ceil(regularProductionTime / tact * occupancyRate)
        : 0;

    const additionalProduction = totalProduction - regularTotalProduction;

    // 日勤のみ：定時ONまたは休出の場合は残業不可
    if (shift === 'day') {
        const checkCell = document.querySelector(
            `.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
        );
        const isRegularHours = checkCell?.getAttribute('data-regular-hours') === 'true';
        const isHolidayWork = checkCell?.textContent.trim() === '休出';

        if (isRegularHours || isHolidayWork) {
            if (additionalProduction > 0) {
                // エラー: 定時内の上限を超過
                return false;
            }
            // 定時内に収まっている場合は正常終了
            return true;
        }
    }
}
```

### 処理フロー

1. **残業入力の存在確認を遅延**: 定時・休出時は残業入力が非表示のため、チェックセル判定より前に存在確認するとearly returnしてしまう
2. **定時・休出チェックを優先**: 日勤で定時ONまたは休出の場合、生産数が定時内上限を超えていないか確認
3. **残業入力チェックは後で実行**: 定時・休出でない場合のみ残業入力の存在を確認

### ライン独立性

各テーブル（ライン）ごとに定時・休出設定は独立しています。

- チェックセルに`data-line-index`属性を付与
- セレクタで`[data-line-index="${lineIndex}"]`を指定して取得

```django
<th class="check-cell"
    data-date-index="{{ forloop.counter0 }}"
    data-line-index="{{ line_index }}"
    data-regular-hours="...">
```

## 在庫計算（良品率適用）

**重要**:
- 在庫はDBから読み込まず、常にフロントエンドで計算
- 計算された在庫値は保存され、翌月の前月末在庫として使用される
- 小数で累積計算し、表示時に整数化（端数による誤差を防止）

```javascript
function updateStockQuantities() {
    const itemNames = getAllItemNames();
    const tables = document.querySelectorAll('table[data-line-index]');

    for (let i = 0; i < itemNames.length; i++) {
        // 前月末在庫から開始（DBから取得）
        let calculatedStock = previousMonthStocks[itemNames[i]] || 0;

        for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
            const yieldRate = linesItemData[lineIndex].yield_rate || 1.0;

            for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
                // 日勤
                const dayProd = getDayProductionValue(...);
                const dayShip = getDayShipmentValue(...);
                // 小数で累積（良品率適用）
                calculatedStock += dayProd * yieldRate - dayShip;
                // 表示時に整数化
                setDayStockValue(..., Math.floor(calculatedStock));

                // 夜勤
                const nightProd = getNightProductionValue(...);
                const nightShip = getNightShipmentValue(...);
                // 小数で累積（良品率適用）
                calculatedStock += nightProd * yieldRate - nightShip;
                // 表示時に整数化
                setNightStockValue(..., Math.floor(calculatedStock));
            }
        }
    }
}
```

**計算ロジック**:
1. 前月末在庫から開始（`previousMonthStocks`）
2. 各直で `在庫 += 生産数 × 良品率 - 出庫数` を小数で累積
3. 表示時に `Math.floor()` で整数化（端数を切り捨て）
4. 保存時は整数化された値を保存
5. 翌月は保存された値を前月末在庫として使用

## テーブル別タクト・良品率

```javascript
const linesItemData = [
    { tact: 0.5, yield_rate: 0.997 },  // #1
    { tact: 0.6, yield_rate: 0.995 }   // #2
];
```

## エラー: 全品番が全テーブル表示

```django
{# 誤: item_names / 正: line_data.item_names #}
{% for item_name in line_data.item_names %}
```

ref: `machining_production_plan.js`
