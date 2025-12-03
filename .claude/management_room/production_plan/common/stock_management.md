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

## 出庫数の計算（鋳造・加工）

### 鋳造の出庫数

鋳造の出庫数は、**加工生産計画から常に計算**され、DBには保存されません。

```python
# 鋳造-加工マッピングを取得
mappings = MachiningItemCastingItemMap.objects.filter(
    casting_line_name=line.name,
    active=True
)

# 加工生産計画から出庫数を計算
for machining_plan in machining_plans:
    if machining_plan.production_quantity:
        delivery += machining_plan.production_quantity
```

**重要**: `DailyCastingProductionPlan.holding_out_count` フィールドは削除されました。出庫数は常に加工の生産数から計算されます。

### 加工の出庫数

加工の出庫数は、**組付け生産計画から常に計算**され、DBには保存されません。

```python
# 組付け-加工マッピングを取得
mappings = AssemblyItemMachiningItemMap.objects.filter(
    machining_item__in=machining_items,
    active=True
)

# 組付け生産計画から出庫数を計算
for assembly_plan in assembly_plans:
    if assembly_plan.production_quantity:
        shipment += assembly_plan.production_quantity
```

**重要**: `DailyMachiningProductionPlan.shipment` フィールドは存在しますが使用されません。出庫数は常に組付けの生産数から計算されます。
