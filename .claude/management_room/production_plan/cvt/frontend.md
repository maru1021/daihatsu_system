# CVT生産計画 フロントエンド仕様

## ドキュメント構成

- **共通モジュール**: [../common/shared_modules.md](../common/shared_modules.md) - 鋳造・CVT共通のJavaScriptモジュール
- **バックエンド**: [backend.md](backend.md) - Python実装
- **概要**: [overview.md](overview.md) - モデル・画面構成

## ファイル構成

- **JavaScript**: `static/js/cvt_production_plan.js` (~1,200行、モジュール化後)
- **HTML**: `management_room/templates/production_plan/cvt_production_plan.html`
- **CSS**: `static/css/production_plan.css` (共通)
- **共通モジュール**: `static/js/shared/casting/` (詳細は [shared_modules.md](../common/shared_modules.md))

## 主要な特徴

### 1. 金型管理なし

CVTラインは金型カウント管理が不要なため、以下の機能を省略：

- ❌ 金型使用回数の表示（`mold-count-display`）
- ❌ 金型引き継ぎ矢印（`drawInheritanceArrows`）
- ❌ 再利用可能金型リスト（`displayReusableMolds`）
- ❌ 6直連続チェック（`getConsecutiveShiftCount`）
- ❌ 金型使用回数の自動カウント（`updateMoldCountForMachineFromShift`）
- ✅ 金型交換時間の**手動入力**（`mold-change-input`）

### 2. 鋳造との違い

| 機能 | 鋳造（ヘッド） | 鋳造（ブロック） | CVT |
|------|----------------|------------------|-----|
| 金型使用回数表示 | ✓ | ✗ | ✗ |
| 金型交換時間入力 | ✓ | ✗ | ✓ |
| 金型引き継ぎ矢印 | ✓ | ✗ | ✗ |
| 型替えハイライト | ✓ | ✓ | ✓ |
| 定時時間（日勤） | 490分 | 455分 | 455分 |
| 定時時間（夜勤） | 485分 | 450分 | 450分 |

## グローバル変数

```javascript
// HTMLから渡される変数
var itemData = {...};                    // 品番データ（タクト、良品率）
var previousMonthInventory = {...};     // 前月在庫

// 定数
const REGULAR_TIME_DAY = 455;           // 日勤定時時間（分）
const REGULAR_TIME_NIGHT = 450;         // 夜勤定時時間（分）
const OVERTIME_MAX_DAY = 120;           // 日勤の残業上限（分）
const OVERTIME_MAX_NIGHT = 60;          // 夜勤の残業上限（分）

// 初期化フラグ
let isInitializing = true;
```

## 主要な関数

### 初期化

#### initialize()
```javascript
async function initialize() {
    // 1. Select2初期化
    $(lineSelect).select2({...});

    // 2. DOMキャッシュ構築
    buildDOMCache();
    buildAllCaches();

    // 3. UI初期化
    initializeSelectColors();
    updateOvertimeInputVisibility();
    initializeWeekendWorkingStatus();

    // 4. イベントリスナー設定
    setupEventListeners();
    setupColumnHover();

    // 5. 初期計算
    await performInitialCalculations();

    // 6. 遅延処理
    updateWorkingDayStatus(false);
    applyItemChangeHighlights();

    // 7. ローディング非表示
    hideLoading();
}
```

#### buildDOMCache()
```javascript
function buildDOMCache() {
    // 定数値をキャッシュ
    domConstantCache.dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;
    domConstantCache.totalMachines = document.querySelectorAll('.facility-number').length / 4;

    // select要素を二次元配列でキャッシュ
    selectElementCache.day[d][m] = document.querySelector(
        `.vehicle-select[data-shift="day"][data-date-index="${d}"][data-machine-index="${m}"]`
    );

    // vehicleSelectCacheも互換性のため維持
    vehicleSelectCache = new Map();

    // CVTではmold-count-displayキャッシュは不要（削除済み）
}
```

### 生産台数計算

#### calculateProduction(dateIndex, shift)
```javascript
function calculateProduction(dateIndex, shift) {
    // 週末チェックをスキップ
    const isWeekend = checkCells[dateIndex].getAttribute('data-weekend') === 'true';
    if (isWeekend && checkCells[dateIndex].textContent.trim() !== '休出') {
        return;
    }

    // 各CVT機の生産数を計算
    for (let machineIndex = 0; machineIndex < totalMachines; machineIndex++) {
        const select = selectElementCache[shift][dateIndex][machineIndex];
        const selectedItem = select?.value;

        if (!selectedItem) continue;

        // タクト・良品率を取得
        const machineName = getMachineName(machineIndex);
        const tact = itemData[selectedItem]?.[machineName]?.tact || 0;
        const yieldRate = itemData[selectedItem]?.[machineName]?.yield_rate || 1;

        // 各種時間を取得
        const baseTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;
        const stopTime = getInputValue(`.stop-time-input[...]`) || 0;
        const moldChangeTime = getInputValue(`.mold-change-input[...]`) || 0;
        const overtime = getInputValue(`.overtime-input[...]`) || 0;
        const occupancyRate = getInputValue(`.operation-rate-input[...]`) / 100 || 1;

        // 稼働時間 = 基本時間 - 計画停止 - 金型交換 + 残業
        const workingTime = Math.max(0, baseTime - stopTime - moldChangeTime + overtime);

        // 良品生産数 = (稼働時間 / タクト) × 良品率 × 稼働率
        const goodCount = Math.floor((workingTime / tact) * yieldRate * occupancyRate);

        // 生産数を更新
        productionInput.value = goodCount;
    }
}
```

### 在庫計算

#### recalculateAllInventory()
```javascript
function recalculateAllInventory() {
    if (isInitializing) return;

    // キャッシュ構築
    if (!inventoryElementCache) {
        inventoryElementCache = buildInventoryElementCache();
    }

    // 全品番を取得
    const itemDataKeys = Object.keys(itemData);
    const prevKeys = Object.keys(previousMonthInventory);
    const allItemNamesArray = [...new Set([...itemDataKeys, ...prevKeys])];

    // 日勤→夜勤の順で計算
    for (let i = 0; i < dateCount; i++) {
        for (let j = 0; j < allItemNamesArray.length; j++) {
            const itemName = allItemNamesArray[j];
            calculateInventory(i, 'day', itemName);
            calculateInventory(i, 'night', itemName);
        }
    }

    // 月末在庫カード更新
    updateInventoryComparisonCard(allItemNamesArray, dateCount);

    // 行合計と溶湯計算を非同期で更新
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
            calculateRowTotals();
            calculateMoltenMetalPotAndCore();
        }, { timeout: 100 });
    }
}
```

#### calculateInventory(dateIndex, shift, itemName)
```javascript
function calculateInventory(dateIndex, shift, itemName) {
    // 前の直の在庫を取得
    let previousInventory = 0;
    if (dateIndex === 0 && shift === 'day') {
        previousInventory = previousMonthInventory[itemName] || 0;
    } else {
        const prev = moveToPrevShift(dateIndex, shift);
        const prevInput = inventoryElementCache.inventory[itemName]?.[prev.shift]?.[prev.dateIndex];
        previousInventory = getInputValue(prevInput);
    }

    // 生産数を取得
    const productionInput = inventoryElementCache.production[itemName]?.[shift]?.[dateIndex];
    const production = getInputValue(productionInput);

    // 在庫調整を取得
    const stockAdjustmentInput = inventoryElementCache.stockAdjustment[itemName]?.[shift]?.[dateIndex];
    const stockAdjustment = getInputValue(stockAdjustmentInput);

    // 在庫計算: 前の直の在庫 + 生産数 + 在庫調整
    const inventory = previousInventory + production + stockAdjustment;

    // 在庫数を更新
    const inventoryInput = inventoryElementCache.inventory[itemName]?.[shift]?.[dateIndex];
    if (inventoryInput) {
        inventoryInput.value = inventory;
    }
}
```

### イベント処理

#### 品番変更イベント
```javascript
// CVT: 金型カウント管理なし
select.addEventListener('change', function () {
    const dateIndex = parseInt(this.dataset.dateIndex);
    const shift = this.dataset.shift;

    updateSelectColor(this);

    // 生産台数と在庫を直接計算
    calculateProduction(dateIndex, shift);
    recalculateAllInventory();
    debouncedApplyHighlights();
});
```

### 型替えハイライト

#### applyItemChangeHighlights()
```javascript
function applyItemChangeHighlights() {
    // CVTラインは金型交換・型替えハイライト処理をスキップ
    // 全日付の生産数を再計算
    const dateCount = domConstantCache.dateCount;
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }
    // 在庫も再計算
    recalculateAllInventory();
}
```

## データ保存

### saveProductionPlan()
```javascript
async function saveProductionPlan() {
    const planData = [];

    // 1. 生産計画データ収集
    document.querySelectorAll('.select-container').forEach(container => {
        const select = container.querySelector('.vehicle-select');
        const dateIndex = parseInt(select.dataset.dateIndex);
        const shift = select.dataset.shift;
        const machineIndex = parseInt(select.dataset.machineIndex);
        const itemName = select.value;

        // CVTラインは金型カウント管理なし
        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            item_name: itemName,
            mold_count: 0,  // CVTでは使用しない
            type: 'production_plan'
        });
    });

    // 2. 金型交換データ収集
    document.querySelectorAll('.mold-change-input').forEach(input => {
        const moldChange = parseInt(input.value) || 0;
        planData.push({
            date_index: parseInt(input.dataset.dateIndex),
            shift: input.dataset.shift,
            machine_index: parseInt(input.dataset.machineIndex),
            mold_change: moldChange,
            type: 'mold_change'
        });
    });

    // 3. CVTラインは金型管理なし
    const usableMoldsData = [];

    // 4. POST送信
    fetch(window.location.href, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            plan_data: planData,
            weekends_to_delete: weekendsToDelete,
            usable_molds_data: usableMoldsData,
            occupancy_rate_data: occupancyRateData,
            regular_working_hours_data: regularWorkingHoursData
        })
    });
}
```

## 自動生成

### autoProductionPlan()
```javascript
async function autoProductionPlan() {
    // 1. データ収集
    const requestData = {
        year: parseInt(year),
        month: parseInt(month),
        line_id: parseInt(lineId),
        weekend_work_dates: weekendWorkDates
    };

    // 2. バックエンドAPI呼び出し
    const response = await fetch('/management_room/production-plan/auto/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify(requestData)
    });

    const data = await response.json();

    // 3. CVTラインは金型管理なし
    window.autoGeneratedUnusedMolds = [];

    // 4. 結果を画面に反映
    data.plans.forEach(plan => {
        const select = document.querySelector(
            `.vehicle-select[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (select) {
            select.value = plan.item_name;
            select.setAttribute('data-vehicle', plan.item_name);
            updateSelectColor(select);
        }

        // 金型交換時間を更新
        const moldChangeInput = document.querySelector(
            `.mold-change-input[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (moldChangeInput) {
            moldChangeInput.value = plan.changeover_time || 0;
        }
    });

    // 5. 生産台数・在庫を再計算
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }
    recalculateAllInventory();
    applyItemChangeHighlights();
}
```

## パフォーマンス最適化

### キャッシュ戦略

```javascript
// ❌ 毎回querySelectorを実行（遅い）
function getSelect(dateIndex, shift, machineIndex) {
    return document.querySelector(
        `.vehicle-select[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
    );
}

// ✅ 二次元配列でキャッシュ（O(1)アクセス）
function getSelect(dateIndex, shift, machineIndex) {
    return selectElementCache[shift][dateIndex][machineIndex];
}
```

### 非同期処理

```javascript
// 重い計算をrequestIdleCallbackで遅延実行
if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
        calculateRowTotals();
        calculateMoltenMetalPotAndCore();
    }, { timeout: 100 });
} else {
    setTimeout(() => {
        calculateRowTotals();
        calculateMoltenMetalPotAndCore();
    }, 50);
}
```

### デバウンス

```javascript
// 連続入力時のパフォーマンス改善
const debounced ApplyHighlights = debounce(applyItemChangeHighlights, 200);

select.addEventListener('change', function () {
    calculateProduction(dateIndex, shift);
    debouncedApplyHighlights();  // 200ms後に1回だけ実行
});
```

## 削除された関数（CVT不要）

以下の28個の金型関連関数は削除済み：

- `setResetFlagForItemAndRecalculate`
- `clearInheritanceChain`
- `clearStaleInheritanceReferences`
- `updateMoldCountForMachineFromShift`
- `recalculateAffectedItems`
- `recalculateAllFromShift`
- `recalculateAllOccurrencesOfItem`
- `clearPreviousInheritance`
- `setInheritanceTarget`
- `setInheritanceInfo`
- `clearInheritanceInfo`
- `isContinuousProductionInNextShift`
- `markPrevMonthMoldAsUsed`
- `clearPrevMonthMoldUsage`
- `checkAndMarkPrevMonthMoldExhausted`
- `checkPrevMonthUsableMolds`
- `checkItemChanges`
- `getConsecutiveShiftCountWithSource`
- `getConsecutiveShiftCount`
- `searchOtherMachinesForCount`
- `getPrevious5Shifts`
- `updateMoldCountFromShiftOnward`
- `collectUsableMoldsData`
- `updateReusableMolds`
- `drawInheritanceArrows`
- `getNextShiftItemName`
- `checkIfContinuousToNextShift`
- `displayReusableMolds`

## 関連ファイル

- [バックエンド仕様](backend.md)
- [概要](overview.md)
- [共通機能](../common/stock_management.md)
