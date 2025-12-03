# 加工生産計画

## システム概要

同一加工ライン名（例: ヘッド）で異なる組付けライン（#1、#2）が在庫共有。`line_name`単位管理、1ページ複数テーブル縦並び、在庫上から下に連続計算。

**2パターンの運用:**
1. **組付ラインと紐づく加工ライン**: `MachiningLine.assembly`が設定（例: #1-ヘッド、#2-ヘッド）
   - 複数ラインの場合、組付側の出庫数を残業時間が均等になるように自動振り分け
2. **組付ラインと紐づかない加工ライン**: `MachiningLine.assembly`がNull（例: CVT）
   - `AssemblyItemMachiningItemMap`の紐づきを元に組付側の出庫数を取得
   - 複数ラインの場合、残業時間が均等になるように自動振り分け
   - 生産数・出庫数・残業時間が自動計算される

**振り分けアルゴリズム:**
1. 品番を分類: 固定品番（1ラインのみ）vs 柔軟な品番（複数ライン）
2. 固定品番を先に割り当て
3. 柔軟な品番を1個ずつ、残業時間差が最小になるラインに割り当て（貪欲法）
4. 結果: 全ラインの残業時間が均等になる

## データモデル

### MachiningLine

```python
class MachiningLine(Line):
    assembly = models.ForeignKey(AssemblyLine, null=True, blank=True)  # Nullの場合は組付ラインと紐づかない
    yield_rate = models.FloatField()  # ライン×組付け単位
    tact = models.FloatField()
```

- **組付ラインと紐づく場合**: 同ライン名でも組付けごと別レコード（例: ヘッド→#1-ヘッド、#2-ヘッド）
- **組付ラインと紐づかない場合**: `assembly=None`で1レコードのみ（例: CVT）

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

### AssemblyItemMachiningItemMap

```python
class AssemblyItemMachiningItemMap(models.Model):
    assembly_item = models.ForeignKey(AssemblyItem)
    machining_item = models.ForeignKey(MachiningItem)
```

組付品番と加工品番の紐づけ。組付ラインと紐づかない加工ラインの場合、この紐づけを元に組付側の出庫数を取得して初期値として使用。

ref: `machining_production_plan.py`, `machining_production_plan.js`
