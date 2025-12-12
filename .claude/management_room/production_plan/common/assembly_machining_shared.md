# 組付・加工 共通モジュール

**パス**: `static/js/management_room/production_plan/shared/assembly_machining/`

組付生産計画（`assembly_production_plan.js`）と加工生産計画（`machining_production_plan.js`）で共通して使用されるJavaScriptモジュール。

## 概要

組付と加工で共通する定数、ユーティリティ関数、制御関数、ナビゲーション関数を抽出してモジュール化。ES6モジュール形式で実装されており、必要な機能を個別にインポートして使用できる。

## ディレクトリ構造

```
shared/assembly_machining/
├── index.js           # エントリーポイント（全モジュールをエクスポート）
├── constants.js       # 定数定義（時間、シフト、スタイルなど）
├── utils.js          # ユーティリティ関数（debounce、DOM操作など）
├── control.js        # 制御関数（toggleCheck、toggleInputs、setOvertimeLimitなど）
├── navigation.js     # ナビゲーション関数（ライン・月選択変更）
├── totals.js         # 合計計算関数（calculateSectionTotal、recalculateOvertimeFromProductionなど）
└── README.md         # 詳細な使い方の説明
```

## モジュール構成

### constants.js - 定数定義

組付と加工で共通する定数を定義。

**時間定数**
- `REGULAR_TIME_DAY`: 日勤定時時間（455分）
- `REGULAR_TIME_NIGHT`: 夜勤定時時間（450分）
- `OVERTIME_MAX_DAY`: 日勤残業上限（120分）
- `OVERTIME_MAX_NIGHT`: 夜勤残業上限（60分）

**その他定数**
- `OVERTIME_ROUND_MINUTES`: 残業時間の丸め単位（5分）
- `OVERTIME_CONSTRAINT_THRESHOLD`: 残業時間の均等制約閾値（5分）
- `NIGHT_SHIFT_UNIFORM_THRESHOLD`: 夜勤の均等配分閾値（60分）
- `STOP_TIME_MAX`: 計画停止の上限（480分）
- `DEBOUNCE_DELAY`: デバウンス遅延時間（100ms）
- `STOCK_UPDATE_DELAY`: 在庫更新遅延時間（150ms）
- `MAX_ADJUSTMENT_ROUNDS`: 微調整の最大反復回数（3回）
- `MAX_OVERTIME_ADJUST_ROUNDS`: 残業調整の最大ループ回数（100回）

**オブジェクト定数**
- `SHIFT`: シフト定数（`{ DAY: 'day', NIGHT: 'night' }`）
- `CELL_TEXT`: セル表示文字列（`{ REGULAR: '定時', WEEKEND_WORK: '休出' }`）
- `STYLE`: スタイル定数（背景色など）

### utils.js - ユーティリティ関数

組付と加工で共通するユーティリティ関数を提供。

**関数一覧**

#### `debounce(func, wait)`
関数の実行を遅延させ、連続した呼び出しを抑制する。
- **引数**: `func` (Function) - 実行する関数、`wait` (number) - 遅延時間（ミリ秒）
- **返り値**: デバウンスされた関数

#### `getInputElement(selector)`
CSSセレクタで入力要素を取得。
- **引数**: `selector` (string) - CSSセレクタ
- **返り値**: HTMLElement | null

#### `getInputValue(input)`
入力値を取得。非表示の場合は0を返す。
- **引数**: `input` (HTMLElement) - 入力要素
- **返り値**: number

#### `setCellStyle(cell, value)`
セルのスタイルを設定（太字、中央揃え、値の表示）。
- **引数**: `cell` (HTMLElement) - セル要素、`value` (number) - 値

#### `getItemNames(lineIndex = null)`
品番リストを取得。
- **引数**: `lineIndex` (number|null) - ラインインデックス（オプション、加工用）
- **返り値**: string[] - 品番リスト
- **組付**: `lineIndex`を省略（全体から取得）
- **加工**: `lineIndex`を指定（特定テーブルから取得）

#### `getShipmentValue(shipmentDisplay)`
出庫数の値を取得（span要素から）。**加工専用**。
- **引数**: `shipmentDisplay` (HTMLElement) - 出庫数表示要素
- **返り値**: number

#### `updateAllItemsProduction(dateIndex, shifts, forceRecalculate, updateProductionQuantity, lineIndex = null)`
全品番の生産数を更新する共通処理。
- **引数**:
  - `dateIndex` (number) - 日付インデックス
  - `shifts` (string[]) - シフト配列
  - `forceRecalculate` (boolean) - 強制再計算フラグ
  - `updateProductionQuantity` (Function) - 生産数更新関数
  - `lineIndex` (number|null) - ラインインデックス（オプション、加工用）

### control.js - 制御関数

組付と加工で共通する制御関数を提供。

#### `toggleCheck(element, updateWorkingDayStatusCallback)`
チェックセルの切り替え（組付専用）。
- **引数**:
  - `element` (HTMLElement) - チェックセル要素
  - `updateWorkingDayStatusCallback` (Function) - 稼働日状態更新のコールバック関数
- **動作**:
  - 空 → '定時' or '休出'（weekend判定により）
  - '定時' or '休出' → 空
  - `data-regular-hours`属性を更新
  - コールバック関数を呼び出して稼働日状態を更新

#### `setOvertimeLimit(dateIndex, shift, max, options = {})`
残業上限を設定（汎用版）。
- **引数**:
  - `dateIndex` (number) - 日付インデックス
  - `shift` (string) - シフト（'day' または 'night'）
  - `max` (number|null) - 残業上限（nullの場合は上限を解除）
  - `options` (Object) - オプション設定
    - `lineIndex` (number|null) - ラインインデックス（デフォルト: null）
- **機能**:
  - 残業入力のmax属性を設定
  - 上限が0の場合は値を0にクリア
  - プログラマティック変更フラグを設定（inputイベント抑制用）

#### `toggleInputs(dateIndex, shift, show, options = {})`
入力フィールドの表示/非表示を制御（汎用版）。
- **引数**:
  - `dateIndex` (number) - 日付インデックス
  - `shift` (string) - シフト（'day' または 'night'）
  - `show` (boolean) - 表示する場合はtrue、非表示にする場合はfalse
  - `options` (Object) - オプション設定
    - `lineIndex` (number|null) - ラインインデックス（デフォルト: null）
    - `includeStockDisplay` (boolean) - 在庫表示も制御する場合はtrue（デフォルト: false）
- **機能**:
  - input要素の表示/非表示を制御
  - 在庫表示（span要素）の制御（オプション）
  - 非表示時に値を0にクリア

#### `updateOvertimeInputVisibility(options = {})`
残業inputの表示/非表示を制御（汎用版）。
- **引数**:
  - `options` (Object) - オプション設定
    - `includeStopTime` (boolean) - 計画停止時間も制御する場合はtrue（デフォルト: false）
- **機能**:
  - 週末（休出なし）: 日勤・夜勤とも非表示
  - 休出: 日勤・夜勤とも非表示
  - 定時: 日勤のみ非表示、夜勤は表示
  - 通常: すべて表示
  - 計画停止時間の制御（オプション）

### totals.js - 合計計算関数

組付と加工で共通する合計計算関数を提供。

#### `calculateSectionTotal(rows, elementClass, options = {})`
セクションごとの合計を計算（汎用版）。
- **引数**:
  - `rows` (NodeList) - 対象行のNodeList
  - `elementClass` (string) - 集計対象要素のクラス名
  - `options` (Object) - オプション設定
    - `showZero` (boolean) - 合計が0の場合も表示するか（デフォルト: false）
    - `targetCellClass` (string) - 合計を表示するセルのクラス名（デフォルト: 'monthly-total'）
- **機能**:
  - input要素またはspan要素の値を合計
  - 月間合計セルに結果を表示
  - 在庫差分セルの特別なスタイル対応

#### `recalculateOvertimeFromProduction(dateIndex, shift, itemName, options = {})`
生産数から残業時間を逆算（汎用版）。
- **引数**:
  - `dateIndex` (number) - 日付インデックス
  - `shift` (string) - シフト（'day' または 'night'）
  - `itemName` (string) - 品番名（未使用だが互換性のため保持）
  - `options` (Object) - オプション設定
    - `lineIndex` (number) - ラインインデックス（デフォルト: 0）
    - `roundingMethod` (string) - 丸め方法（'round' または 'ceil'、デフォルト: 'round'）
    - `linesItemData` (Object) - ラインごとのアイテムデータ（加工用）
    - `itemData` (Object) - アイテムデータ（組付用）
    - `showToast` (Function) - トースト表示関数
- **機能**:
  - 全品番の生産数合計から必要な残業時間を計算
  - 定時/休出の場合の残業不可チェック
  - 残業上限チェックとエラー表示
- **返り値**: boolean - 入力が許可される場合はtrue、拒否される場合はfalse

### navigation.js - ナビゲーション関数

ライン・月選択変更のハンドラーを生成するファクトリー関数を提供。

#### `createHandleLineChange(paramName = 'line')`
ライン選択変更ハンドラーを作成する。
- **引数**: `paramName` (string) - URLパラメータ名
  - 組付: `'line'`
  - 加工: `'line_name'`
- **返り値**: Function - ライン選択変更ハンドラー

#### `createHandleMonthChange(paramName = 'line')`
月選択変更ハンドラーを作成する。
- **引数**: `paramName` (string) - URLパラメータ名
  - 組付: `'line'`
  - 加工: `'line_name'`
- **返り値**: Function - 月選択変更ハンドラー

## 使用方法

### 基本的なインポート

```javascript
import {
    // 定数
    REGULAR_TIME_DAY,
    REGULAR_TIME_NIGHT,
    OVERTIME_MAX_DAY,
    OVERTIME_MAX_NIGHT,
    SHIFT,
    CELL_TEXT,
    STYLE,

    // ユーティリティ関数
    debounce,
    getInputElement,
    getInputValue,
    setCellStyle,
    getItemNames,

    // 制御関数
    toggleCheck,
    setOvertimeLimit,
    toggleInputs,
    updateOvertimeInputVisibility,

    // 合計計算関数
    calculateSectionTotal,
    recalculateOvertimeFromProduction,

    // ナビゲーション関数
    createHandleLineChange,
    createHandleMonthChange
} from './shared/assembly_machining/index.js';
```

### 組付での使用例

```javascript
import {
    REGULAR_TIME_DAY,
    OVERTIME_MAX_DAY,
    CELL_TEXT,
    debounce,
    getInputElement,
    getItemNames,
    toggleCheck as toggleCheckCommon,
    setOvertimeLimit,
    toggleInputs,
    updateOvertimeInputVisibility,
    calculateSectionTotal,
    recalculateOvertimeFromProduction,
    createHandleLineChange,
    createHandleMonthChange
} from './shared/assembly_machining/index.js';

// ライン選択変更ハンドラーを作成（組付は'line'パラメータ）
const handleLineChange = createHandleLineChange('line');
const handleMonthChange = createHandleMonthChange('line');

// イベントリスナーを設定
$('#line-select').on('change', handleLineChange);
$('#target-month').on('change', handleMonthChange);

// toggleCheckのラッパーを作成（組付固有の処理を追加）
window.toggleCheck = function(element) {
    toggleCheckCommon(element, (dateIndex) => {
        // 組付固有の稼働日状態更新処理
        debouncedUpdateWorkingDayStatus(dateIndex);
        updateOvertimeInputVisibility(); // オプションなしで呼び出し（includeStopTime: false）
        setTimeout(() => updateRowTotals(), 150);
    });
};

// 品番リストを取得（組付はlineIndexを省略）
const itemNames = getItemNames();

// 残業上限を設定（組付用）
setOvertimeLimit(dateIndex, 'day', 120); // lineIndexオプションなし

// 入力フィールドの表示/非表示を制御（組付用）
toggleInputs(dateIndex, 'day', true); // includeStockDisplayオプションなし

// セクションごとの合計を計算
calculateSectionTotal(rows, 'production-input'); // オプションなし

// 生産数から残業時間を逆算（組付用）
const isValid = recalculateOvertimeFromProduction(dateIndex, shift, itemName, {
    lineIndex: 0,
    roundingMethod: 'round',
    linesItemData: null,
    itemData: window.itemData,
    showToast: window.showToast
});
```

### 加工での使用例

```javascript
import {
    REGULAR_TIME_DAY,
    OVERTIME_MAX_DAY,
    SHIFT,
    CELL_TEXT,
    debounce,
    getInputElement,
    getInputValue,
    getItemNames,
    getShipmentValue,
    setOvertimeLimit,
    toggleInputs,
    updateOvertimeInputVisibility,
    calculateSectionTotal,
    recalculateOvertimeFromProduction,
    createHandleLineChange,
    createHandleMonthChange
} from './shared/assembly_machining/index.js';

// ライン選択変更ハンドラーを作成（加工は'line_name'パラメータ）
const handleLineChange = createHandleLineChange('line_name');
const handleMonthChange = createHandleMonthChange('line_name');

// イベントリスナーを設定
$('#line-select').on('change', handleLineChange);
$('#target-month').on('change', handleMonthChange);

// 品番リストを取得（加工はlineIndexを指定）
const itemNames = getItemNames(lineIndex);

// 出庫数を取得（加工専用）
const shipmentValue = getShipmentValue(shipmentDisplay);

// 残業上限を設定（加工用、lineIndexオプション付き）
setOvertimeLimit(dateIndex, 'day', 120, { lineIndex });

// 入力フィールドの表示/非表示を制御（加工用、在庫表示も制御）
toggleInputs(dateIndex, 'day', true, { lineIndex, includeStockDisplay: true });

// 残業inputの表示/非表示を更新（加工用、計画停止時間も制御）
updateOvertimeInputVisibility({ includeStopTime: true });

// セクションごとの合計を計算（オプション付き）
calculateSectionTotal(rows, 'production-input', { showZero: false, targetCellClass: 'monthly-total' });

// 生産数から残業時間を逆算（加工用）
const isValid = recalculateOvertimeFromProduction(dateIndex, shift, itemName, {
    lineIndex,
    roundingMethod: 'ceil',
    linesItemData: window.linesItemData,
    itemData: null,
    showToast: window.showToast
});
```

## 注意事項

### 1. ES6モジュール

すべてのファイルはES6モジュール形式で記述されています。

HTMLで使用する際は `<script type="module">` を使用：

```html
<script type="module" src="{% static 'js/management_room/production_plan/assembly_production_plan.js' %}"></script>
```

### 2. 共通化された関数の使用方法

以下の関数は共通モジュールに含まれており、オプションパラメータで組付と加工の違いを吸収しています。

#### `toggleInputs(dateIndex, shift, show, options)`
入力フィールドの表示/非表示を制御。
- **組付**: オプションなしで呼び出し（デフォルト動作）
- **加工**: `{ lineIndex, includeStockDisplay: true }` を指定

#### `setOvertimeLimit(dateIndex, shift, max, options)`
残業時間の上限を設定。
- **組付**: オプションなしで呼び出し（デフォルト動作）
- **加工**: `{ lineIndex }` を指定

#### `updateOvertimeInputVisibility(options)`
残業input要素の表示/非表示を更新。
- **組付**: オプションなしで呼び出し（`includeStopTime: false`）
- **加工**: `{ includeStopTime: true }` を指定

#### `calculateSectionTotal(rows, elementClass, options)`
セクションごとの合計を計算。
- **組付**: オプションなしで呼び出し（デフォルト動作）
- **加工**: 必要に応じて `{ showZero, targetCellClass }` を指定

#### `recalculateOvertimeFromProduction(dateIndex, shift, itemName, options)`
生産数から残業時間を逆算。
- **組付**: `{ lineIndex: 0, roundingMethod: 'round', linesItemData: null, itemData, showToast }` を指定
- **加工**: `{ lineIndex, roundingMethod: 'ceil', linesItemData, itemData: null, showToast }` を指定

### 3. パラメータの違い

一部の関数は組付と加工で引数が異なります：

| 関数 | 組付 | 加工 |
|------|------|------|
| `getItemNames()` | `lineIndex`不要（省略） | `lineIndex`必須 |
| `updateAllItemsProduction()` | `lineIndex`不要（省略） | `lineIndex`必須 |
| `createHandleLineChange()` | `paramName = 'line'` | `paramName = 'line_name'` |
| `createHandleMonthChange()` | `paramName = 'line'` | `paramName = 'line_name'` |

### 4. 段階的な移行

既存のコードを段階的に移行できるよう設計されています。必要に応じて個別の関数をインポートして使用できます。

## ファイルパス

**モジュールディレクトリ**: `static/js/management_room/production_plan/shared/assembly_machining/`

**参照ドキュメント**: `static/js/management_room/production_plan/shared/assembly_machining/README.md`

**使用元ファイル**:
- `static/js/management_room/production_plan/assembly_production_plan.js`
- `static/js/management_room/production_plan/machining_production_plan.js`
