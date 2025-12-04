# 鋳造ライン別機能仕様

## 概要

鋳造生産計画では、ライン（ヘッド、ブロック、カバー）によって機能が異なります。

## ライン別機能比較

| 機能 | ヘッド | ブロック | カバー |
|------|--------|----------|--------|
| **定時時間（日勤）** | 490分 | 455分 | 455分 |
| **定時時間（夜勤）** | 485分 | 450分 | 450分 |
| **金型使用回数表示** | ✓ | ✗ | ✗ |
| **金型交換時間入力** | ✓ | ✗ | ✓ |
| **再利用可能金型リスト** | ✓ | ✗ | ✗ |
| **金型引き継ぎ矢印** | ✓ | ✗ | ✗ |
| **夜勤型替え時残業禁止** | ✓ | ✗ | ✗ |
| **6直連続ハイライト** | ✓ | ✗ | ✗ |

## ライン種別の判定

### バックエンド（Python）

`management_room/views/production_plan/casting_production_plan.py`:

```python
# ライン種別の判定
is_head_line = line.name == 'ヘッド'
is_block_line = line.name == 'ブロック'
is_cover_line = line.name == 'カバー'

# コンテキストに渡す
context = {
    'is_head_line': is_head_line,      # ヘッドラインかどうか（全機能有効）
    'is_block_line': is_block_line,    # ブロックラインかどうか（型替え不要）
    'is_cover_line': is_cover_line,    # カバーラインかどうか（型替え時間のみ）
}
```

### テンプレート（Django）

`management_room/templates/production_plan/casting_production_plan.html`:

```django
<!-- 金型引き継ぎの矢印（ヘッドラインのみ） -->
{% if is_head_line %}
<svg id="inheritance-arrows">...</svg>
{% endif %}

<!-- 再利用可能金型（ヘッドラインのみ） -->
{% if is_head_line %}
<tr class="reusable-molds-row">...</tr>
{% endif %}

<!-- 生産計画の金型カウント表示（ヘッドラインのみ） -->
<select class="vehicle-select">...</select>
{% if is_head_line %}
<span class="mold-count-display">...</span>
{% endif %}

<!-- 金型交換セクション（ブロックライン以外 = ヘッド + カバー） -->
{% if not is_block_line %}
<tr data-section="mold_change">...</tr>
{% endif %}

<!-- JavaScriptに渡す -->
<script>
isHeadLine = {% if is_head_line %}true{% else %}false{% endif %};
isBlockLine = {% if is_block_line %}true{% else %}false{% endif %};
isCoverLine = {% if is_cover_line %}true{% else %}false{% endif %};
</script>
```

### JavaScript

`static/js/casting_production_plan.js`:

```javascript
// グローバル変数宣言
/* global isHeadLine, isBlockLine, isCoverLine */

// 定時時間の設定
if (isHeadLine) {
    REGULAR_TIME_DAY = 490;     // ヘッドラインの日勤定時時間（分）
    REGULAR_TIME_NIGHT = 485;   // ヘッドラインの夜勤定時時間（分）
} else {
    // ブロックライン・カバーライン
    REGULAR_TIME_DAY = 455;     // 日勤定時時間（分）
    REGULAR_TIME_NIGHT = 450;   // 夜勤定時時間（分）
}
```

## 機能別詳細

### 1. 定時時間

**ヘッドライン**: 日勤490分、夜勤485分
**ブロック・カバー**: 日勤455分、夜勤450分

```javascript
// casting_production_plan.js (30-37行目)
if (isHeadLine) {
    REGULAR_TIME_DAY = 490;
    REGULAR_TIME_NIGHT = 485;
} else {
    REGULAR_TIME_DAY = 455;
    REGULAR_TIME_NIGHT = 450;
}
```

### 2. 金型使用回数表示（ヘッドのみ）

品番横に表示される数字（1, 2, 3...6）で、金型の使用回数を示します。

**実装箇所**:
- テンプレート: `{% if is_head_line %}<span class="mold-count-display">...</span>{% endif %}`
- JavaScript関数: `updateMoldCount()`, `getConsecutiveShiftCount()`

```javascript
// casting_production_plan.js (1607-1610行目)
function getConsecutiveShiftCount(dateIndex, shift, machineIndex, currentItem) {
    // ヘッドライン以外は常に0を返す
    if (!isHeadLine) {
        return { count: 0, inherited: false, source: null };
    }
    // ...
}
```

### 3. 金型交換時間（ヘッド・カバー）

型替え時に入力する金型交換時間です。

**適用ライン**: ヘッド、カバー（ブロックのみ不要）

**実装箇所**:
- テンプレート: `{% if not is_block_line %}<tr data-section="mold_change">...</tr>{% endif %}`

### 4. 再利用可能金型リスト（ヘッドのみ）

使いかけの金型（型数1～5）を一覧表示し、他の設備で再利用できるようにします。

**実装箇所**:
- テンプレート: `{% if is_head_line %}<tr class="reusable-molds-row">...</tr>{% endif %}`
- JavaScript関数: `updateReusableMolds()`, `displayReusableMolds()`

```javascript
// casting_production_plan.js (3450-3453行目)
function updateReusableMolds() {
    // ヘッドライン以外は処理をスキップ
    if (!isHeadLine) {
        return;
    }
    // ...
}
```

### 5. 金型引き継ぎ矢印（ヘッドのみ）

金型が設備間で引き継がれる様子を矢印で視覚化します。

**実装箇所**:
- テンプレート: `{% if is_head_line %}<svg id="inheritance-arrows">...</svg>{% endif %}`
- JavaScript関数: `drawInheritanceArrows()`

```javascript
// casting_production_plan.js (3582-3585行目)
function drawInheritanceArrows() {
    // ヘッドライン以外は処理をスキップ
    if (!isHeadLine) {
        return;
    }
    // ...
}
```

### 6. 夜勤型替え時残業禁止（ヘッドのみ）

夜勤で型替えがある場合、残業時間を0に固定し、入力を禁止します。

**理由**: 夜勤での型替えは時間がかかるため、残業させずに定時で終わらせる運用。

**実装箇所**:
- 型替えハイライト処理: `applyItemChangeHighlights()` (1529行目、1545行目)
- 生産数計算処理: `calculateProduction()` (2343行目、2384行目)

```javascript
// casting_production_plan.js (1529行目)
if (isHeadLine && shift === 'night') {
    const overtimeInput = document.querySelector(
        `.overtime-input[data-shift="night"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
    );
    if (overtimeInput && overtimeInput.style.display !== 'none') {
        overtimeInput.value = 0;
        overtimeInput.disabled = true;
        overtimeInput.style.backgroundColor = '#f0f0f0';
    }
}
```

### 7. 6直連続ハイライト（ヘッドのみ）

同じ品番が6の倍数直目（6, 12, 18...）で生産される場合、金型交換時期として強調表示します。

**実装箇所**:
- JavaScript関数: `is6ConsecutiveShifts()`

```javascript
// casting_production_plan.js (1577-1579行目)
function is6ConsecutiveShifts(dateIndex, shift, machineIndex, currentItem) {
    // ヘッドライン以外は常にfalse
    if (!isHeadLine) {
        return false;
    }
    // ...
}
```

## 動作確認ポイント

### ヘッドライン

- [x] 定時時間: 日勤490分、夜勤485分
- [x] 金型使用回数が品番横に表示される（1, 2, 3...6）
- [x] 金型交換セクションが表示される
- [x] 再利用可能金型リストが表示される
- [x] 引き継ぎの矢印が表示される
- [x] 夜勤の型替え時に残業が禁止される（入力欄が無効化）
- [x] 6の倍数直目でハイライト表示される

### ブロックライン

- [x] 定時時間: 日勤455分、夜勤450分
- [x] 金型使用回数が表示されない
- [x] 金型交換セクションが非表示
- [x] 再利用可能金型リストが非表示
- [x] 引き継ぎの矢印が表示されない
- [x] 夜勤で残業可能（型替え制約なし）
- [x] 品番変更時に生産台数が正しく再計算される

### カバーライン

- [x] 定時時間: 日勤455分、夜勤450分
- [x] 金型使用回数が表示されない
- [x] 金型交換セクションが表示される（時間入力のみ）
- [x] 再利用可能金型リストが非表示
- [x] 引き継ぎの矢印が表示されない
- [x] 夜勤で残業可能（型替え制約なし）
- [x] 金型交換時間が生産時間から減算される

## 設計思想

1. **ヘッドライン**: 最も複雑な金型管理が必要なため、すべての機能を有効化
2. **ブロックライン**: 金型交換が不要なため、金型関連機能をすべて無効化
3. **カバーライン**: 金型交換は必要だが、使用回数の追跡は不要なため、交換時間入力のみ有効化

この設計により、各ラインの実際の運用に合わせた最適な機能セットを提供できます。

## 実装ファイル

- Backend: `management_room/views/production_plan/casting_production_plan.py`
- Template: `management_room/templates/production_plan/casting_production_plan.html`
- Frontend: `static/js/casting_production_plan.js`

## 関連ドキュメント

- [金型管理](mold_management.md): 金型の使用回数追跡と引き継ぎロジック
- [アルゴリズム](algorithm.md): 生産数計算と在庫管理のアルゴリズム
- [フロントエンド](frontend.md): JavaScript実装の詳細
