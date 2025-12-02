# 加工生産計画

## システム概要

同一加工ライン名（例: ヘッド）で異なる組付けライン（#1、#2）が在庫共有。`line_name`単位管理、1ページ複数テーブル縦並び、在庫上から下に連続計算。

## データモデル

### MachiningLine

```python
class MachiningLine(Line):
    assembly = models.ForeignKey(AssemblyLine)
    yield_rate = models.FloatField()  # ライン×組付け単位
    tact = models.FloatField()
```

同ライン名でも組付けごと別レコード（例: ヘッド→#1-ヘッド、#2-ヘッド）

### MachiningItem

```python
class MachiningItem(models.Model):
    line = models.ForeignKey(MachiningLine)
    name = models.CharField()
```

組付けライン別生産可能品番（例: #1は5品番、#2は3品番）

### MachiningStock

```python
class MachiningStock(models.Model):
    line_name = models.CharField()  # 組付けID含まず
    item_name = models.CharField()
    date = models.DateField()
    shift = models.CharField()  # 'day'/'night'
    stock = models.IntegerField()
```

`line_name`単位管理（在庫共有）、全直保存

ref: `machining_production_plan.py`, `machining_production_plan.js`
