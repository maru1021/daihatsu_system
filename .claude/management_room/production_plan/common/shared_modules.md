# 共通モジュール (Shared Modules)

## 概要

鋳造系生産計画（鋳造・CVT）のJavaScriptコードを共通化し、保守性とコードの重複を削減するためのモジュール群。

## ファイル構成

```
static/js/management_room/production_plan/shared/casting/
├── index.js           # エントリーポイント・エクスポート統合 (268行)
├── utils.js           # ユーティリティ関数 (175行)
├── cache.js           # キャッシュ構築 (216行)
├── inventory.js       # 在庫計算 (183行)
├── calculation.js     # 集計・計算処理 (235行)
├── control.js         # UI制御 (239行)
├── initialization.js  # 初期化処理 (119行)
├── README.md          # モジュール説明
└── MIGRATION_GUIDE.md # 移行ガイド
```

**合計**: 約1,435行（モジュール分割により個別ファイルは120-270行に抑制）

## モジュール詳細

### 1. utils.js (175行)

#### 目的
汎用的なヘルパー関数を提供

#### 主要な関数

```javascript
// デバウンス処理（連続呼び出し抑制）
export function debounce(func, wait)

// シフト移動
export function moveToNextShift(dateIndex, shift)  // 日勤→夜勤、夜勤→翌日勤
export function moveToPrevShift(dateIndex, shift)  // 夜勤→日勤、日勤→前夜勤

// 設備名取得
export function getMachineName(machineIndex, domCache)

// 稼働している次/前の直を取得
export function getNextWorkingShift(dateIndex, shift, machineIndex, caches)
export function getPrevWorkingShift(dateIndex, shift, machineIndex, caches)

// 品番一覧取得
export function getItemNames()

// DOM要素取得
export function getInputElement(selector)
export function getInputValue(input)

// Cookie取得
export function getCookie(name)
```

### 2. cache.js (216行)

#### 目的
DOM要素とデータのキャッシュを構築してパフォーマンスを最適化

#### 主要な関数

```javascript
// DOMキャッシュ構築（select要素、コンテナなど）
export function buildDOMCache(options, caches)
// options.includeMoldCount: 金型カウント表示をキャッシュするか（鋳造=true、CVT=false）

// 在庫関連要素のキャッシュ
export function buildInventoryElementCache()
// 返り値: { inventory: {}, delivery: {}, production: {}, stockAdjustment: {} }

// 月末在庫カード要素のキャッシュ
export function buildInventoryCardCache()

// 残業入力要素のキャッシュ
export function buildOvertimeInputCache()

// 溶湯・ポット数・中子要素のキャッシュ
export function buildMoltenMetalElementCache()
```

**キャッシュ構造例**:
```javascript
// selectElementCache[shift][dateIndex][machineIndex]
selectElementCache.day[0][0] // 1日目日勤の1号機のselect要素

// inventoryElementCache.inventory[itemName][shift][dateIndex]
inventoryElementCache.inventory['VET2']['day'][5] // VET2の6日目日勤の在庫input
```

### 3. inventory.js (183行)

#### 目的
在庫数の計算と月末在庫カードの更新

#### 主要な関数

```javascript
// 特定の直の在庫を計算
export function calculateInventory(dateIndex, shift, itemName, inventoryCache, previousMonthInventory)
// 計算式: 前の直の在庫 + 生産数 + 在庫調整 - 出庫数

// 全品番・全直の在庫を一括再計算
export function recalculateAllInventory(state, caches, itemData, previousMonthInventory)
// 日勤→夜勤の順で計算し、月末在庫カードも更新

// 月末在庫カード更新（目標・実績の比較表示）
export function updateInventoryComparisonCard(allItemNamesArray, dateCount, caches, itemData, previousMonthInventory)
```

**在庫計算フロー**:
```
1日目日勤 → 1日目夜勤 → 2日目日勤 → ... → 31日目夜勤
   ↓           ↓           ↓                    ↓
在庫計算    在庫計算    在庫計算            月末在庫カード更新
```

### 4. calculation.js (235行)

#### 目的
行合計、溶湯、ポット数、中子の計算

#### 主要な関数

```javascript
// 複数inputの値を合計
export function sumInputValues(inputs)

// 品番別・直別の合計（日勤 or 夜勤）
export function calculateShiftTotalByItem(className, inputClass, dataKey)

// 品番別の合計（日勤+夜勤）
export function calculateCombinedTotalByItem(className, inputClass, dataKey)

// 設備別・直別の合計
export function calculateShiftTotalByMachine(className, inputClass)

// 設備別の合計（日勤+夜勤）
export function calculateCombinedTotalByMachine(className, inputClass)

// 溶湯、ポット数、中子の計算
export function calculateMoltenMetalPotAndCore(caches, itemData)
// - 溶湯重量 = 生産台数 × 単重
// - ポット数 = 溶湯重量 / 160kg（切り上げ）
// - 中子数 = Math.round(生産台数 / 24) × 24

// 全ての行合計を計算
export function calculateRowTotals(caches)
```

### 5. control.js (239行)

#### 目的
UI制御（休出チェック、色変更、残業表示制御など）

#### 主要な関数

```javascript
// 休出チェックのトグル
export function toggleCheck(element, updateCallback)
// 平日: 定時 ⇄ (空白)
// 週末: 休出 ⇄ (空白)

// 休出・定時状態の初期化
export function initializeWeekendWorkingStatus()

// 稼働日状態の更新（休出チェックに応じてselect/inputを表示/非表示）
export function updateWorkingDayStatus(recalculate, caches, calculateProductionFunc, recalculateInventoryFunc, updateOvertimeFunc)

// select要素の色を品番に応じて変更
export function updateSelectColor(select, colorMap)

// 残業inputの表示/非表示制御
export function updateOvertimeInputVisibility(caches)
// 金型交換がある場合のみ表示（鋳造ヘッド・カバー）
// CVTは常に表示
```

### 6. initialization.js (119行)

#### 目的
初期化処理の共通化

#### 主要な関数

```javascript
// キャッシュ一括構築
export function buildAllCaches(refs)
// refs.setInventoryElementCache, setInventoryCardCache等のsetter関数を受け取る

// セレクトボックスの色初期化とイベント設定
export function initializeSelectColors(options)
// options.updateSelectColorWrapper: select色更新関数
// options.applyItemChangeHighlights: ハイライト適用関数
// options.onSelectChange: select変更時のコールバック

// 初期計算実行
export function performInitialCalculations(options)
// options.domConstantCache: DOM定数キャッシュ
// options.setInitializing: isInitializingフラグ設定関数
// options.calculateProduction: 生産台数計算関数
// options.recalculateAllInventoryWrapper: 在庫再計算関数
// options.beforeCalculation: 計算前の処理（オプション）
```

### 7. index.js (268行)

#### 目的
全モジュールを統合してエクスポート

#### エクスポート形式

```javascript
// クラス形式（将来的な拡張用）
export class CastingPlan { ... }

// 個別関数（既存コードとの互換性）
export const debounce = Utils.debounce;
export const buildDOMCache = Cache.buildDOMCache;
export const recalculateAllInventory = Inventory.recalculateAllInventory;
// ... 全38個の関数
```

## 使用方法

### インポート

```javascript
// casting_production_plan.js / cvt_production_plan.js
import {
    debounce,
    buildDOMCache,
    buildInventoryElementCache,
    recalculateAllInventory,
    calculateRowTotals,
    updateSelectColor,
    updateWorkingDayStatus,
    getMachineName,
    moveToNextShift,
    moveToPrevShift,
    // ... 他の関数
} from './shared/casting/index.js';
```

### ラッパー関数の作成

共通モジュールの関数は引数として`caches`, `state`, `colorMap`などを必要とするため、各ファイルで**ラッパー関数**を作成します。

```javascript
// ========================================
// グローバルキャッシュ
// ========================================
let domConstantCache = { dateCount: 0, totalMachines: 0, ... };
let selectElementCache = { day: [], night: [] };
let inventoryElementCache = null;
// ... 他のキャッシュ

// ========================================
// ラッパー関数
// ========================================
function getCaches() {
    return {
        domConstantCache,
        selectElementCache,
        inventoryElementCache,
        inventoryCardCache,
        overtimeInputCache,
        moltenMetalElementCache,
        vehicleSelectCache,
        moldChangeInputCache,
        selectContainerCache
    };
}

function buildDOMCacheWrapper(options = {}) {
    const caches = getCaches();
    const result = buildDOMCache(options, caches);
    // 結果をローカルキャッシュに反映
    vehicleSelectCache = result.vehicleSelectCache;
    moldChangeInputCache = result.moldChangeInputCache;
    selectContainerCache = result.selectContainerCache;
}

function recalculateAllInventoryWrapper() {
    const state = { isInitializing };
    const caches = getCaches();
    const result = recalculateAllInventory(state, caches, itemData, previousMonthInventory);

    // 行合計と溶湯計算を非同期で更新
    if (result && typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
            calculateRowTotalsWrapper();
            calculateMoltenMetalPotAndCoreWrapper();
        }, { timeout: 100 });
    }
}

function updateSelectColorWrapper(select) {
    updateSelectColor(select, colorMap);
}

function getMachineNameWrapper(machineIndex) {
    return getMachineName(machineIndex, domConstantCache);
}

// ... 他のラッパー関数
```

### 呼び出し時の注意点

**❌ 直接呼び出し（エラー）**:
```javascript
// caches引数が渡されないためエラー
buildDOMCache({ includeMoldCount: true });
recalculateAllInventory();
updateSelectColor(select);
```

**✅ ラッパー関数経由（正しい）**:
```javascript
buildDOMCacheWrapper({ includeMoldCount: true });
recalculateAllInventoryWrapper();
updateSelectColorWrapper(select);
```

**✅ 引数なしの関数は直接呼び出しOK**:
```javascript
// これらは引数不要なので直接呼び出し可能
inventoryElementCache = buildInventoryElementCache();
inventoryCardCache = buildInventoryCardCache();
overtimeInputCache = buildOvertimeInputCache();
initializeWeekendWorkingStatus();
```

## ライン別の違い

### 鋳造（ヘッド・ブロック・カバー）

```javascript
// 金型カウント表示あり（ヘッドのみ）
buildDOMCacheWrapper({ includeMoldCount: true });

// 金型関連の独自関数を追加実装
function updateMoldCountForMachineFromShift(dateIndex, shift, machineIndex, oldItem, newItem, oldMoldInfo) {
    // 金型使用回数を更新
}

function drawInheritanceArrows() {
    // 金型引き継ぎ矢印を描画
}
```

### CVT

```javascript
// 金型カウント表示なし
buildDOMCacheWrapper({ includeMoldCount: false });

// 金型関連の独自関数は不要（削除済み）
```

## パフォーマンス最適化

### 1. キャッシュ戦略

```javascript
// ❌ 毎回DOM検索（遅い）
const select = document.querySelector(`.vehicle-select[data-shift="${shift}"]...`);

// ✅ 配列キャッシュ（O(1)アクセス）
const select = selectElementCache[shift][dateIndex][machineIndex];
```

### 2. 非同期処理

```javascript
// 重い計算を遅延実行（初期表示を高速化）
if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
        calculateRowTotalsWrapper();
        calculateMoltenMetalPotAndCoreWrapper();
    }, { timeout: 100 });
}
```

### 3. デバウンス

```javascript
// 連続入力時の再計算を抑制
const debouncedRecalculateInventory = debounce(recalculateAllInventoryWrapper, 300);

input.addEventListener('input', function () {
    debouncedRecalculateInventory();  // 300ms後に1回だけ実行
});
```

## コード削減効果

### リファクタリング前後の比較

| ファイル | 削除行数 | 追加行数 | 純削減 |
|---------|---------|---------|-------|
| casting_production_plan.js | -756 | +284 | -472 |
| cvt_production_plan.js | -608 | +0 | -608 |
| **合計** | **-1,364** | **+284** | **-1,080** |

**共通モジュール**: +1,435行（新規作成）

**正味削減**: 約**350行**（重複コードの削減 + モジュール分割による可読性向上）

### 追加で共通化した関数（initialization.js）

1. **buildAllCaches()** - キャッシュ一括構築（完全に同一）
2. **initializeSelectColors()** - セレクトボックス初期化（コールバックで分岐）
3. **performInitialCalculations()** - 初期計算（コールバックで分岐）

これにより、鋳造とCVTの初期化処理が統一され、保守性が向上しました。

## トラブルシューティング

### エラー1: `Cannot destructure property 'domConstantCache' of 'caches' as it is undefined`

**原因**: 直接`buildDOMCache()`を呼び出している

**解決策**: ラッパー関数を使用
```javascript
// ❌ buildDOMCache({ includeMoldCount: true });
// ✅
buildDOMCacheWrapper({ includeMoldCount: true });
```

### エラー2: `Cannot read properties of undefined (reading 'isInitializing')`

**原因**: 直接`recalculateAllInventory()`を呼び出している

**解決策**: ラッパー関数を使用
```javascript
// ❌ recalculateAllInventory();
// ✅
recalculateAllInventoryWrapper();
```

### エラー3: `moveToNextShift is not defined`

**原因**: インポート漏れ

**解決策**: インポートに追加
```javascript
import {
    // ...
    moveToNextShift,
    moveToPrevShift,
    // ...
} from './shared/casting/index.js';
```

## 関連ドキュメント

- [鋳造フロントエンド](../casting/frontend.md)
- [CVTフロントエンド](../cvt/frontend.md)
- [パフォーマンス最適化](performance.md)
- [在庫管理](stock_management.md)
