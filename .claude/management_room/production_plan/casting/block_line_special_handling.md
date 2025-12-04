# ブロックライン特別処理

> **Note**: このドキュメントは古いバージョンです。最新のライン別機能仕様は [line_specific_features.md](line_specific_features.md) を参照してください。

## 概要

ブロックラインでは、他の鋳造ライン（ヘッド、カバーなど）と異なり、**型替え（金型交換）という概念がない**ため、金型関連の処理をすべて無効化する必要がある。

## 型替えが不要な理由

ブロックラインでは、金型を頻繁に交換する必要がないため、以下の機能が不要：

- 金型使用数のカウント（生産計画横の数値）
- 型替え時間（金型交換セクション）
- 再利用可能金型リスト
- 金型引き継ぎの矢印表示
- 夜勤の型替え時の残業制約

## 実装場所

### バックエンド

#### `casting_production_plan.py`

```python
# ライン取得直後に判定フラグを設定
is_block_line = line.name == 'ブロック'

# データが1件もない場合のチェック
has_no_data = is_block_line and not plans.exists()

# デフォルト品番設定（データがない場合のみ）
elif has_no_data and not is_weekend:
    if machine_name == '#2':
        selected_item = 'VE'
    elif machine_name == '#4':
        selected_item = 'VE7'

# コンテキストに渡す
context = {
    'is_block_line': is_block_line,
    # ...
}
```

**ポイント**:
- `is_block_line`: ライン名が「ブロック」かどうか
- `has_no_data`: 対象月にデータが1件もないか（停止日などがある場合は適用しない）
- デフォルト品番: #2=VE, #4=VE7

### テンプレート

#### `casting_production_plan.html`

```django
<!-- 金型引き継ぎの矢印（ブロックライン以外） -->
{% if not is_block_line %}
<svg id="inheritance-arrows">...</svg>
{% endif %}

<!-- 再利用可能金型（ブロックライン以外） -->
{% if not is_block_line %}
<tr class="reusable-molds-row">...</tr>
{% endif %}

<!-- 生産計画の金型カウント表示（ブロックライン以外） -->
<select class="vehicle-select">...</select>
{% if not is_block_line %}
<span class="mold-count-display">...</span>
{% endif %}

<!-- 金型交換セクション（ブロックライン以外） -->
{% if not is_block_line %}
<tr data-section="mold_change">...</tr>
{% endif %}

<!-- JavaScriptに渡す -->
<script>
isBlockLine = {% if is_block_line %}true{% else %}false{% endif %};
</script>
```

### JavaScript

#### `casting_production_plan.js`

##### ヘルパー関数

```javascript
/**
 * 金型関連処理が必要かどうかを判定
 * @returns {boolean} 金型処理が必要な場合true
 */
function shouldProcessMoldOperations() {
    return !isBlockLine;
}

/**
 * 夜勤の型替え時残業制約が必要かどうかを判定
 * @returns {boolean} 制約が必要な場合true
 */
function shouldApplyNightMoldChangeOvertimeConstraint() {
    return !isBlockLine;
}
```

##### 無効化される関数

| 関数名 | 処理内容 | ブロックラインでの動作 |
|--------|----------|----------------------|
| `updateMoldCount()` | 金型使用数の更新 | 早期リターン（処理なし） |
| `updateMoldCountForMachineFromShift()` | 金型使用数の一括更新 | 生産数・在庫の再計算のみ実行 |
| `checkItemChanges()` | 型替え時間の自動設定 | 型替え処理をスキップ、生産数計算のみ |
| `applyItemChangeHighlights()` | 型替えハイライト | 型替え処理をスキップ、生産数・在庫計算のみ |
| `is6ConsecutiveShifts()` | 6直連続チェック | 常に`false`を返す |
| `getConsecutiveShiftCount()` | 連続使用数の取得 | 常に`{count: 0, inherited: false, source: null}`を返す |
| `updateReusableMolds()` | 再利用可能金型の更新 | 早期リターン（処理なし） |
| `drawInheritanceArrows()` | 引き継ぎ矢印の描画 | 早期リターン（処理なし） |

##### 品番変更時の処理

```javascript
// 金型情報の取得（金型処理が不要な場合はnull）
const oldMoldInfo = shouldProcessMoldOperations() ? {
    isPrevMonthMold: moldDisplay?.getAttribute('data-prev-month-mold') === 'true',
    prevMonthCount: parseInt(moldDisplay?.getAttribute('data-prev-month-count')) || 0,
    currentCount: parseInt(moldDisplay?.textContent) || 0
} : null;

// 金型カウント更新は金型処理が必要な場合のみ
updateMoldCountForMachineFromShift(dateIndex, shift, machineIndex, oldItem, newItem, oldMoldInfo);
```

##### 夜勤の残業制約

```javascript
// 夜勤の型替え時の残業制約（金型処理が必要な場合のみ）
if (shouldApplyNightMoldChangeOvertimeConstraint()) {
    const [shift, dateIndex, machineIndex] = key.split('-');
    if (shift === 'night') {
        overtimeInput.value = 0;
        overtimeInput.disabled = true;
    }
}
```

## 動作確認ポイント

### ブロックライン

- [ ] 金型カウント表示が非表示
- [ ] 生産計画横に数値（1, 2, 3...）が表示されない
- [ ] 金型交換セクションが非表示
- [ ] 再利用可能金型リストが非表示
- [ ] 引き継ぎの矢印が表示されない
- [ ] 夜勤で型替えがあっても残業可能（制約なし）
- [ ] 品番変更時に生産台数が正しく再計算される
- [ ] データがない新規月で#2=VE, #4=VE7が自動設定される
- [ ] 一部データがある月ではデフォルト値が適用されない

### 他のライン（ヘッド、シリンダーなど）

- [ ] 金型カウント表示が表示される
- [ ] 型替え時に金型交換セクションが更新される
- [ ] 再利用可能金型リストが表示される
- [ ] 引き継ぎの矢印が表示される
- [ ] 夜勤の型替え時に残業が制約される
- [ ] 従来通りすべての機能が動作する

## 注意事項

1. **他ラインへの影響**: ブロックライン専用の処理は、`is_block_line`フラグで制御されているため、他のラインには一切影響しない

2. **デフォルト品番**: 対象月にデータが**1件もない場合のみ**適用される。停止日などで一部データがある場合は適用されない

3. **生産数計算**: 金型処理はスキップされるが、生産数と在庫の計算は正常に実行される

4. **パフォーマンス**: 金型関連の重い処理がスキップされるため、ブロックラインでは処理が高速化される

## 関連ファイル

- Backend: `management_room/views/production_plan/casting_production_plan.py`
- Template: `management_room/templates/production_plan/casting_production_plan.html`
- Frontend: `static/js/casting_production_plan.js`
