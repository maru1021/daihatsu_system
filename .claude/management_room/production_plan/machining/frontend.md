# 加工フロントエンド

## 生産数（良品率含まず）

```javascript
生産数 = (定時 + 残業 - 計画停止) / タクト × 稼働率
```

## 在庫計算（良品率適用）

```javascript
function updateStockQuantities() {
    const itemNames = getAllItemNames();
    const tables = document.querySelectorAll('table[data-line-index]');

    for (let i = 0; i < itemNames.length; i++) {
        let calculatedStock = previousMonthStocks[itemNames[i]] || 0;

        for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
            const yieldRate = linesItemData[lineIndex].yield_rate || 1.0;

            for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
                // 日勤
                const dayProd = getDayProductionValue(...);
                const dayShip = getDayShipmentValue(...);
                calculatedStock += dayProd * yieldRate - dayShip;
                setDayStockValue(..., Math.floor(calculatedStock));

                // 夜勤
                const nightProd = getNightProductionValue(...);
                const nightShip = getNightShipmentValue(...);
                calculatedStock += nightProd * yieldRate - nightShip;
                setNightStockValue(..., Math.floor(calculatedStock));
            }
        }
    }
}
```

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
