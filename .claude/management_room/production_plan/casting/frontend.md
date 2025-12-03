# 鋳造フロントエンド

## 引き継ぎ双方向管理

```html
<td data-mold-inheritance-target="line-1-date-2-shift-day">VE7 (型数3)</td>
<td data-mold-inheritance="line-1-date-1-shift-day">VE7 (型数4) ←</td>
```

矢印: 他設備からのみ

## 品番変更時クリア（3方向）

```javascript
function clearMoldInheritance(cellId, itemName) {
    // 1. 前: 連鎖クリア
    const targetId = cell.dataset.moldInheritance;
    if (targetId) clearMoldInheritance(targetId, itemName);

    // 2. 後: 参照クリア
    const sourceCell = document.querySelector(`[data-mold-inheritance="${cellId}"]`);
    if (sourceCell) sourceCell.removeAttribute('data-mold-inheritance');

    // 3. 全体: 品番不一致削除
    document.querySelectorAll('[data-mold-inheritance-target]').forEach(cell => {
        if (cell.dataset.item !== itemName) {
            cell.removeAttribute('data-mold-inheritance-target');
        }
    });
}
```

## 前月金型再利用

```javascript
const prevMonthMoldsStatus = { 'VE7': { used: false, used_count: 3 } };
prevMonthMoldsStatus[itemName].used = true;
updateReusableMolds();  // used=falseのみ表示
```

必須: 引継元`data-mold-inheritance-target`、引継先`data-mold-inheritance`、品番変更時3方向クリア

## 中子計算（24の倍数）

```javascript
// 生産数から中子を計算（24の倍数に丸める）
const coreCount = Math.round(productionValue / 24) * 24;

// 例:
// 生産数 50 → 中子 48
// 生産数 60 → 中子 60
// 生産数 12 → 中子 12
```

**適用箇所**:
- フロントエンド: `calculateMoltenMetalPotAndCore()` 関数
- Excel出力: `_write_casting_core_section()` メソッド

ref: `casting_production_plan.js`
