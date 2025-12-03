# 在庫管理共通

## 良品率（小数累積→表示時整数化）

```javascript
calculatedStock += production * yieldRate - shipment;
input.value = Math.floor(calculatedStock);
```

## 前月末在庫

```python
.order_by('-id').first()  # shiftソートは順序不定でNG
```

## 出庫数（上位工程から計算、DBに保存しない）

- **鋳造**: 加工生産数の合計（`holding_out_count`削除済み）
- **加工**: 組付け生産数の合計（`shipment`フィールド未使用）
