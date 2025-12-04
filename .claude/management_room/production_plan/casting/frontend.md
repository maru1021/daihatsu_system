# 鋳造フロントエンド

ライン別機能の詳細: [line_specific_features.md](line_specific_features.md)

## 金型引き継ぎ（ヘッドのみ）

- 矢印: 他設備からのみ
- 品番変更: 3方向クリア（前・後・全体品番不一致）
- 前月金型: `prevMonthMoldsStatus[itemName].used = true` → `used=false`のみ表示

## 中子（24の倍数）

```javascript
const coreCount = Math.round(productionValue / 24) * 24;
```
