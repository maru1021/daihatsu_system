# 組付・加工 共通モジュール

**パス**: `static/js/management_room/production_plan/shared/assembly_machining/`

組付生産計画（`assembly_production_plan.js`）と加工生産計画（`machining_production_plan.js`）で共通して使用されるJavaScriptモジュール。

## 概要

組付と加工で共通する定数、ユーティリティ関数、制御関数、ナビゲーション関数を抽出してモジュール化。ES6モジュール形式で実装されており、必要な機能を個別にインポートして使用できる。

## ディレクトリ構造

```
shared/assembly_machining/
├── index.js           # エントリーポイント
├── constants.js       # 定数定義
├── utils.js          # ユーティリティ関数
├── control.js        # 制御関数（toggleCheckのみ）
├── navigation.js     # ナビゲーション関数
└── README.md         # 使い方の説明
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

組付と加工で共通するユーティリティ関数。

**関数一覧**
- `debounce(func, wait)`: 関数の実行を遅延させる
- `getInputElement(selector)`: 入力要素を取得
- `getInputValue(input)`: 入力値を取得（非表示の場合は0）
- `setCellStyle(cell, value)`: セルのスタイルを設定
- `getItemNames(lineIndex)`: 品番リストを取得（lineIndexはオプション）
- `getShipmentValue(shipmentDisplay)`: 出庫数の値を取得（加工用）
- `updateAllItemsProduction(...)`: 全品番の生産数を更新（ヘルパー関数）

### control.js - 制御関数

組付専用の制御関数を提供。

**関数一覧**
- `toggleCheck(element, callback)`: チェックセルの切り替え（組付専用）

**注意**: `toggleInputs`、`setOvertimeLimit`、`updateOvertimeInputVisibility` は組付と加工で実装が異なるため、各ファイルで独自実装を使用。

### navigation.js - ナビゲーション関数

ライン・月選択変更のハンドラーを生成するファクトリー関数。

**関数一覧**
- `createHandleLineChange(paramName)`: ライン選択変更ハンドラーを作成
  - 組付: `paramName = 'line'`
  - 加工: `paramName = 'line_name'`
- `createHandleMonthChange(paramName)`: 月選択変更ハンドラーを作成

## 使用方法

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
    createHandleLineChange,
    createHandleMonthChange
} from './shared/assembly_machining/index.js';

// ライン選択変更ハンドラー（組付は'line'パラメータ）
const handleLineChange = createHandleLineChange('line');
const handleMonthChange = createHandleMonthChange('line');

// toggleCheckのラッパー
window.toggleCheck = function(element) {
    toggleCheckCommon(element, (dateIndex) => {
        // 組付固有の処理
        debouncedUpdateWorkingDayStatus(dateIndex);
        updateOvertimeInputVisibility();
        setTimeout(() => updateRowTotals(), 150);
    });
};
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
    getItemNames,
    getShipmentValue,
    createHandleLineChange,
    createHandleMonthChange
} from './shared/assembly_machining/index.js';

// ライン選択変更ハンドラー（加工は'line_name'パラメータ）
const handleLineChange = createHandleLineChange('line_name');
const handleMonthChange = createHandleMonthChange('line_name');

// 品番リストを取得（加工はlineIndexを指定）
const itemNames = getItemNames(lineIndex);
```

## 注意事項

### ES6モジュール

すべてのファイルはES6モジュール形式で記述されています。

HTMLで使用する際は `<script type="module">` を使用：

```html
<script type="module" src="{% static 'js/management_room/production_plan/assembly_production_plan.js' %}"></script>
```

### 各ファイルで独自実装が必要な関数

以下の関数は組付と加工で実装が異なるため、共通モジュールには含まれていません：

**組付と加工で異なる関数**
- `toggleInputs(dateIndex, shift, show, lineIndex)`: 入力フィールドの表示制御
  - 加工: 在庫表示（span要素）の制御を含む
- `setOvertimeLimit(dateIndex, shift, max, lineIndex)`: 残業上限設定
  - 加工: プログラマティック変更フラグの設定を含む
- `updateOvertimeInputVisibility()`: 残業input表示制御
  - 加工: 計画停止時間の制御を含む、lineCount パラメータが必要

これらは各ファイルで独自に実装されています。

## 参考

詳細な使用方法は以下を参照：
- `static/js/management_room/production_plan/shared/assembly_machining/README.md`
