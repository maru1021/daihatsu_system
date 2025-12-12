# 組付・加工系生産計画 共通モジュール

このディレクトリには、組付生産計画（`assembly_production_plan.js`）と加工生産計画（`machining_production_plan.js`）で共通して使用される関数と定数が含まれています。

## ディレクトリ構造

```
shared/assembly_machining/
├── index.js           # エントリーポイント
├── constants.js       # 定数定義
├── utils.js          # ユーティリティ関数
├── control.js        # 稼働日状態管理
├── navigation.js     # ライン・月選択変更処理
└── README.md         # このファイル
```

## モジュール説明

### constants.js

組付と加工で共通する定数を定義しています。

- **時間定数**
  - `REGULAR_TIME_DAY`: 日勤定時時間（455分）
  - `REGULAR_TIME_NIGHT`: 夜勤定時時間（450分）
  - `OVERTIME_MAX_DAY`: 日勤残業上限（120分）
  - `OVERTIME_MAX_NIGHT`: 夜勤残業上限（60分）

- **その他定数**
  - `OVERTIME_ROUND_MINUTES`: 残業時間の丸め単位（5分）
  - `DEBOUNCE_DELAY`: デバウンス遅延時間（100ms）
  - `CELL_TEXT`: セル表示文字列（'定時', '休出'）
  - `SHIFT`: シフト定数（'day', 'night'）
  - `STYLE`: スタイル定数（背景色）

### utils.js

組付と加工で共通するユーティリティ関数を提供しています。

- **`debounce(func, wait)`**: 関数の実行を遅延させる
- **`getInputElement(selector)`**: 入力要素を取得
- **`getInputValue(input)`**: 入力値を取得（非表示の場合は0）
- **`setCellStyle(cell, value)`**: セルのスタイルを設定
- **`getItemNames(lineIndex)`**: 品番リストを取得
- **`getShipmentValue(shipmentDisplay)`**: 出庫数の値を取得（加工用）
- **`updateAllItemsProduction(...)`**: 全品番の生産数を更新

### control.js

稼働日状態の制御に関する関数を提供しています。

- **`toggleInputs(dateIndex, shift, show, lineIndex)`**: 入力フィールドの表示/非表示を制御
- **`setOvertimeLimit(dateIndex, shift, max, lineIndex)`**: 残業上限を設定
- **`updateOvertimeInputVisibility(lineCount)`**: 残業inputの表示/非表示制御
- **`toggleCheck(element, callback)`**: チェックセルの切り替え（組付専用）

### navigation.js

ライン・月選択変更に関する関数を提供しています。

- **`createHandleLineChange(paramName)`**: ライン選択変更ハンドラーを作成
- **`createHandleMonthChange(paramName)`**: 月選択変更ハンドラーを作成

## 使用例

### 組付生産計画での使用例

```javascript
import {
    REGULAR_TIME_DAY,
    REGULAR_TIME_NIGHT,
    OVERTIME_MAX_DAY,
    OVERTIME_MAX_NIGHT,
    CELL_TEXT,
    debounce,
    getInputElement,
    getInputValue,
    setCellStyle,
    getItemNames,
    toggleInputs,
    setOvertimeLimit,
    updateOvertimeInputVisibility,
    toggleCheck,
    createHandleLineChange,
    createHandleMonthChange
} from './shared/assembly_machining/index.js';

// ライン選択変更ハンドラーを作成（組付は'line'パラメータを使用）
const handleLineChange = createHandleLineChange('line');
const handleMonthChange = createHandleMonthChange('line');

// イベントリスナー設定
$('#line-select').on('change', handleLineChange);
$('#target-month').on('change', handleMonthChange);

// 残業inputの表示/非表示を更新（組付はlineCount不要）
updateOvertimeInputVisibility();
```

### 加工生産計画での使用例

```javascript
import {
    REGULAR_TIME_DAY,
    REGULAR_TIME_NIGHT,
    OVERTIME_MAX_DAY,
    OVERTIME_MAX_NIGHT,
    CELL_TEXT,
    debounce,
    getInputElement,
    getInputValue,
    setCellStyle,
    getItemNames,
    getShipmentValue,
    toggleInputs,
    setOvertimeLimit,
    updateOvertimeInputVisibility,
    createHandleLineChange,
    createHandleMonthChange
} from './shared/assembly_machining/index.js';

// ライン選択変更ハンドラーを作成（加工は'line_name'パラメータを使用）
const handleLineChange = createHandleLineChange('line_name');
const handleMonthChange = createHandleMonthChange('line_name');

// イベントリスナー設定
$('#line-select').on('change', handleLineChange);
$('#target-month').on('change', handleMonthChange);

// 残業inputの表示/非表示を更新（加工はlineCountを指定）
const lineCount = domCache.lineCount;
updateOvertimeInputVisibility(lineCount);

// 品番リストを取得（加工は lineIndex を指定）
const itemNames = getItemNames(lineIndex);
```

## 注意事項

1. **ES6 モジュールを使用**
   - すべてのファイルは ES6 モジュール形式で記述されています
   - HTML で `<script type="module">` を使用してインポートしてください

2. **引数の違いに注意**
   - 一部の関数は組付と加工で引数が異なります（`lineIndex` の有無）
   - 関数のドキュメントを確認して正しく使用してください

3. **既存コードとの互換性**
   - 既存のコードを段階的に移行できるよう設計されています
   - 必要に応じて個別の関数をインポートして使用できます

## 今後の拡張

今後、以下の機能の共通化を検討できます：

- イベントリスナー設定の共通部分
- 初期化処理の共通部分
- 保存処理の共通部分（データ構造は異なるが、フローは類似）
- 残業時間計算の共通部分
