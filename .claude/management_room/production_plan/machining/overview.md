# 加工生産計画

## 概要

- 同ライン名（例: ヘッド）で異なる組付け（#1、#2）が在庫共有
- 1ページ複数テーブル縦並び、在庫上から下に連続計算

## 運用パターン

1. **組付ラインと紐づく**: `MachiningLine.assembly`あり（例: #1-ヘッド）
2. **組付ラインと紐づかない**: `MachiningLine.assembly=None`（例: CVT）
   - `AssemblyItemMachiningItemMap`で組付側出庫数を取得

## 複数ライン時の振り分け（残業均等化）

1. 固定品番（1ラインのみ）を先に割り当て
2. 柔軟な品番（複数ライン）を1個ずつ残業時間差が最小のラインに割り当て（貪欲法）

## モデル

- **MachiningLine**: `assembly` (FK or None)、`yield_rate`、`tact`
- **MachiningStock**: `line_name`単位、全直保存
- **AssemblyItemMachiningItemMap**: 組付-加工品番紐づけ
