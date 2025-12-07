# 組付生産計画 - 概要

## モデル

### MonthlyAssemblyProductionPlan
月別組付生産計画

**フィールド**:
- `month`: 対象月
- `line`: 組付ライン（FK: AssemblyLine）
- `production_item`: 品番（FK: AssemblyItem）
- `quantity`: 数量
- `tact`: タクト（台/分）

**重要**:
- タクトは同一ライン・同一月内で全品番共通
- 月・ラインごとに異なる値を持つ

### DailyAssemblyProductionPlan
日別組付生産計画

**フィールド**:
- `date`: 日付
- `line`: 組付ライン
- `production_item`: 品番
- `shift`: シフト（day/night）
- `production_quantity`: 生産数量
- `stop_time`: 計画停止時間（分）
- `overtime`: 残業時間（分）
- `occupancy_rate`: 稼働率（0.0-1.0）
- `regular_working_hours`: 定時フラグ

## タクト管理

### 優先順位
1. `MonthlyAssemblyProductionPlan.tact`（月別計画）
2. `AssemblyLine.tact`（ライン設定）

### 使用箇所
- **生産数量入力**: 各ラインの比率計算
- **組付生産計画**: 残業時間・生産数の自動計算

## ビュー

### ProductionVolumeInputView
月別生産計画の数量・タクト入力

**エンドポイント**: `/production-plan/production-volume-input/`

**機能**:
- 月別数量・タクト登録
- ライン別比率の自動計算・調整

### AssemblyProductionPlanView
日別生産計画の作成・管理

**エンドポイント**: `/production-plan/assembly-production-plan/`

**機能**:
- 日別生産数の入力・自動計算
- 残業時間の最適化
- 月別計画との差分表示
