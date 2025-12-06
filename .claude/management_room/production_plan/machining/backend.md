# 加工バックエンド

## データフロー

```
組付け生産計画 → 出庫数計算 → (複数ライン時)残業均等化振り分け
→ フロントエンドで在庫計算 → 保存時: 在庫のみDB保存
```

## 保存データ

| データ | GET | POST | 備考 |
|--------|-----|------|------|
| 出庫数 | 組付けから計算 | × | リアルタイム反映 |
| 在庫数 | JSで計算 | ○ | 翌月の前月末在庫用 |
| 生産数 | DBから取得 | ○ | ユーザー入力 |

## 出庫数計算

```python
# _get_shipment_for_item
# 複数ライン: allocated_shipment_map (振り分け後)
# 単一ライン: assembly_shipment_map (全量)
```

### 組付け-加工マッピング

組付け品番と加工品番は`AssemblyItemMachiningItemMap`で紐付け。**重要**: マッピング時に`MachiningLine.assembly_id == AssemblyItem.line_id`をチェックし、対応する組付けラインの生産数のみを集計。

```python
# _get_assembly_shipment_data (646-656行目)
for mapping in assembly_mappings_for_all:
    if mapping.machining_item.line.assembly_id == mapping.assembly_item.line_id:
        # 正しい組付けラインの品番のみマッピング
        machining_to_assembly_map[machining_name].append((assembly_name, assembly_line_id))
```

**例**: VE5 → VE6 (#1, #2)、S系(VE4S) → S系P/S系VN/A (#1, #2)

## 残業均等化振り分け

1. `_get_assembly_shipment_data`: 組付けから出庫数取得
2. `_classify_items`: 固定品番 vs 柔軟な品番
3. `_allocate_fixed_items`: 固定品番を先に割り当て
4. `_allocate_flexible_items`: 1個ずつ残業時間差が最小のラインへ（貪欲法）

## 残業時間計算

```python
# assembly=Noneの場合のみ自動計算
required_time = total_production * tact
available_time = (regular_time - stop_time) * occupancy_rate
overtime = max(0, required_time - available_time)  # 5分刻み切り上げ
```

## 保存処理

- `shipment`: 保存しない（常に計算）
- `stock`: フロントエンド計算値を保存
- `bulk_update`: `shipment`を除外
