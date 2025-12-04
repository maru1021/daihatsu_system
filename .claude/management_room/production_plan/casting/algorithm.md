# 鋳造アルゴリズム

**適用ライン**: ヘッドのみ（金型管理が必要なため）

詳細: [ライン別機能仕様](line_specific_features.md)

## 優先順位

1. 矢印最小化（6直連続）
2. 残個数均等化
3. 適正在庫維持

## 初期化

```python
# 月末取付: 同設備のみ継続
# 月内途中外し: prev_detached_molds、次回+1
next_changeover_timing[machine_id] = current_shift + (THRESHOLD - shift_count)
```

## 品番選定

1. 6直分禁止パターン違反なし
2. 在庫切れ早い順
3. 月末在庫最小

禁止パターン: `prohibited_patterns['VE7_VET2'] = 3` → VE7=2 + VET2=1 = 3でNG
