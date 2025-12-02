# 在庫管理共通仕様

## 良品率適用（小数累積）

```javascript
// 誤: 各直でMath.floor → 誤差累積
const goodProduction = Math.floor(production * yieldRate);
stock += goodProduction - shipment;

// 正: 小数累積 → 表示時のみ整数化
const goodProduction = production * yieldRate;
stock += goodProduction - shipment;
input.value = Math.floor(stock);
```

## 前月末在庫（idソート）

```python
# 正: idソート（最終直不定でも正確）
.order_by('-id').first()

# 誤: shiftソート（day/night順序不定）
.order_by('-date', '-shift')
```

## データモデル

- **Stock**: `line_name`単位（在庫共有）、全直保存
- **Line**: ライン基本クラス（鋳造/加工/組付け）
- **Item**: 品番（ラインごと生産可能品番異なる）
