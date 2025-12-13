# 行ホバー機能（鋳造・CVT）

## 概要

鋳造・CVT生産計画の行ホバー機能。品番行と設備行の両方に対応し、セルと行ヘッダーで異なる動作を提供。

## ファイル

- **実装**: `static/js/management_room/production_plan/shared/casting/row_hover.js`
- **エクスポート**: `static/js/management_room/production_plan/shared/casting/index.js`

## 主要機能

### 1. セルホバー（設備セル）

#### 品番がある場合
- **対象**: 生産計画、残業、停止時間、金型交換のセル
- **動作**:
  - その品番の全行をハイライト
  - **＋** その設備の全行もハイライト

```javascript
// 例: VE4Sが選択されている生産計画セルにホバー
// → VE4Sの全行（出庫数、生産台数、在庫数など）
// → その設備の全行（生産計画、残業、停止時間、金型交換）
```

#### 品番がない場合（土日など）
- **動作**: その設備の全行のみハイライト

```javascript
// 例: 土日の空セルにホバー
// → その設備の全行のみハイライト
```

### 2. 行ヘッダーホバー（`th` 要素）

#### 品番行
- **動作**: その品番の全行をハイライト

#### 設備行
- **動作**:
  - その設備の全行をハイライト
  - **＋** その設備で生産している全品番の行をハイライト

```javascript
// 例: 設備#1のヘッダーにホバー
// → 設備#1の全行
// → 設備#1で生産している全品番（VE4S、DK4Sなど）の全行
```

## アーキテクチャ

### 定数

```javascript
const IDENTIFIER_TYPE = {
    ITEM: 'item',      // 品番
    MACHINE: 'machine' // 設備
};

const SECTION = {
    PRODUCTION_PLAN: 'production_plan',
    OVERTIME: 'overtime',
    STOP_TIME: 'stop_time',
    MOLD_CHANGE: 'mold_change'
};
```

### 主要関数

#### 識別情報取得
- `getRowIdentifier(row)`: 行から識別情報を取得
- `getCellIdentifier(cell)`: セルから品番の識別情報を取得
- `getItemIdentifiersFromMachineRow(row, shift, machineIndex)`: 設備行から品番リストを取得

#### ホバー処理
- `executeRowHeaderHover(row, identifier, currentHoverKey)`: 行ヘッダーホバー処理
- `executeMachineCellHover(cellIdentifier, rowIdentifier, currentHoverKey)`: 設備セルホバー処理

#### ハイライト
- `highlightMatchingRows(identifier)`: 単一の識別情報に一致する行をハイライト
- `highlightMultipleRows(identifiers)`: 複数の識別情報に一致する行をハイライト

## 処理フロー

```
mouseover イベント
    │
    ├─ セル（td）検出？
    │   │
    │   ├─ Yes → 設備セル？
    │   │   │
    │   │   ├─ Yes → executeMachineCellHover()
    │   │   │         ├─ 品番あり → 品番 + 設備をハイライト
    │   │   │         └─ 品番なし → 設備のみハイライト
    │   │   │
    │   │   └─ No  → 何もしない
    │   │
    │   └─
    │
    └─ 行ヘッダー（th）検出？
        │
        └─ Yes → executeRowHeaderHover()
                  ├─ 品番行 → 品番をハイライト
                  └─ 設備行 → 設備 + 全品番をハイライト
```

## 使用例

### インポートと初期化

```javascript
import { setupCastingRowHover } from './shared/casting/index.js';

// ページ読み込み時
setupCastingRowHover();
```

### HTML構造要件

#### 品番行
```html
<tr data-shift="day" data-item="VE4S">
    <th>日勤</th>
    <th class="vehicle-label">VE4S</th>
    <!-- セル -->
</tr>
```

#### 設備行
```html
<tr data-section="production_plan" data-shift="day" data-machine-index="0">
    <th>生産計画</th>
    <th>日勤</th>
    <th class="facility-number">M1</th>
    <td data-shift="day" data-date-index="0" data-machine-index="0">
        <select class="vehicle-select">
            <option value="">-</option>
            <option value="VE4S" selected>VE4S</option>
        </select>
    </td>
</tr>
```

## CSS

```css
/* ホバー時のスタイル */
tr.row-hover td {
    background-color: var(--hover-gray);
}

tr.row-hover td.weekend {
    background-color: var(--weekend-hover);
}

tr.row-hover th.vehicle-label {
    background-color: #fff9c4 !important;
}

tr.night-shift.row-hover td {
    background-color: var(--night-shift-hover) !important;
}
```

## 注意点

1. **品番の取得**: `select.value` を使用（動的変更に対応）
2. **空文字列の処理**: 空の品番は `null` として扱う
3. **ホバーキー**: 同じキーの場合は処理をスキップ（パフォーマンス最適化）
4. **mouseout**: `tbody` 全体から出た時のみハイライトを削除

## 関連ファイル

- 共通モジュール: `static/js/management_room/production_plan/shared/common.js`（組付・加工用の基本ホバー処理）
- CSS: `static/css/production_plan.css`
