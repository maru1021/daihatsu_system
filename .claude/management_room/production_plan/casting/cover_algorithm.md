# カバーライン自動生産計画アルゴリズム

## 概要

カバーラインの自動生産計画は、**在庫切れを防ぎつつ、型替えを最小化**することを目的とする。
ヘッドラインとは異なり、金型管理の制約がないため、より柔軟な計画が可能。

## ヘッドラインとの違い

| 項目 | ヘッドライン | カバーライン |
|------|------------|------------|
| 金型管理 | あり（6直制約） | なし |
| 型替え可能品番 | あり | なし（すべての品番で自由に型替え可能） |
| 在庫上限 | なし | 1000個 |
| 設備別タクト | なし（品番ごとに統一） | あり（CastingItemMachineMap） |
| 型替え時間 | 30分 | 30分 |

## アルゴリズムの構造

### ファイル構成

- **メソッド**: `_generate_auto_plan_cover()` in `auto_casting_production_plan.py`
- **ヘルパー関数** (メソッド内定義):
  - `evaluate_item_urgency()`: 緊急度評価
  - `find_machine_for_item()`: 設備割り当て
  - `calculate_production()`: 生産数計算
  - `calculate_optimal_overtime()`: 最適残業時間計算

## 処理フロー

各直（day/night）ごとに以下の手順を実行:

```
1. 出荷予定を取得
2. 緊急度評価 (evaluate_item_urgency)
   ├─ 出荷後在庫を計算
   ├─ 在庫切れまでの直数を計算
   ├─ 継続生産可能かチェック（#650t#1, #650t#2のみ）
   └─ ソート（緊急度 → 出荷後在庫 → 継続生産）
3. 品番割り当て（緊急度順に処理）
   ├─ 設備を探す (find_machine_for_item)
   │   ├─ 継続生産可能な設備を優先
   │   └─ なければ最速タクトの設備を選択
   ├─ 残業時間を計算 (calculate_optimal_overtime)
   └─ 生産数を計算 (calculate_production)
4. 生産実行（在庫に追加）
5. 出荷処理（在庫から減算）
```

### 重要な処理順序

**生産 → 出荷** の順序で処理する。これにより、在庫がマイナスになることを防ぐ。

## 緊急度評価 (`evaluate_item_urgency`)

### 計算ロジック

```python
# 出荷後在庫を計算
stock_after_delivery = current_stock - delivery_this_shift

# 在庫切れまでの直数を計算
if stock_after_delivery < 0:
    shifts_until_stockout = 0  # 緊急度最高
else:
    shifts_until_stockout = calculate_shifts_until_stockout(
        item_name, shift_idx + 1, initial_stock=stock_after_delivery
    )
```

### 継続生産可能性の判定

**対象設備**: `#650t#1`, `#650t#2`のみ

**理由**:
- `#800t#3`は作れる設備の制約上、継続生産の優先対象から除外
- `#650t#1`, `#650t#2`で生産可能な品番は継続生産を優先することで型替えを削減

```python
can_continue = any(
    machine_current_item.get(m.id) == item_name
    for m in machines
    if m.name in ['650t#1', '650t#2']
)
```

### ソート順序

品番の処理順序を決定する3段階のソートキー:

1. **第1キー**: `shifts_until_stockout`（在庫切れまでの直数、少ない順）
   - 0直（この直で在庫切れ）が最優先
   - 1直、2直、3直...と続く

2. **第2キー**: `stock_after_delivery`（出荷後在庫、少ない順）
   - マイナスが深刻な順（-317 < -157 < 25）
   - CCHが#1/#2でしか作れない場合、在庫不足を優先

3. **第3キー**: `can_continue`（継続生産可能性、継続可=0が優先）
   - 同じ緊急度・在庫状況なら継続生産を優先
   - 型替え時間を削減

```python
item_urgency.sort(key=lambda x: (
    x['shifts_until_stockout'],   # 緊急度
    x['stock_after_delivery'],    # 在庫不足の深刻度
    0 if x['can_continue'] else 1 # 継続生産可能性
))
```

### 例: 10/2 day直の処理順序

```
緊急度評価:
  CCH: 出荷後-317台, 在庫切れまで0直 → (0, -317, 1) → 1位
  CCS【継続可】: 出荷後25台, 在庫切れまで0直 → (0, 25, 0) → 3位
  POL(7)【継続可】: 出荷後86台, 在庫切れまで0直 → (0, 86, 0) → 4位

処理順序:
  1. CCH → #2に割り当て（#1/#2でしか作れない、最速タクト）
  2. CCS → #2が埋まっているため#3に割り当て
  3. POL(7) → #1に継続割り当て（型替えなし）
```

## 設備割り当て (`find_machine_for_item`)

### 優先順位

1. **継続生産**: 前の直で同じ品番を生産していた設備（型替えなし）
2. **最速タクト**: タクトが最も小さい（速い）設備

### ロジック

```python
def find_machine_for_item(item_name):
    # 1. 継続生産できる設備を探す
    for machine in machines:
        if machine.id in assigned_machines:
            continue
        if machine_current_item.get(machine.id) == item_name:
            key = f"{item_name}_{machine.id}"
            if key in item_data:
                return machine, True  # 継続生産

    # 2. 最速タクトの設備を探す
    available_machines = []
    for machine in machines:
        if machine.id in assigned_machines:
            continue
        key = f"{item_name}_{machine.id}"
        if key in item_data:
            available_machines.append(machine)

    if not available_machines:
        return None, False

    best_machine = min(available_machines, key=lambda m: item_data[f"{item_name}_{m.id}"]['tact'])
    return best_machine, False
```

### 設備-品番マッピング

品番ごとに生産可能な設備とタクトは異なる（`CastingItemMachineMap`から取得）:

| 設備 | POL | POL(7) | CCS | CCH | CCL | CCL(7) |
|------|-----|--------|-----|-----|-----|--------|
| 650t#1 | 0.67秒 | 0.72秒 | 0.85秒 | 0.72秒 | - | - |
| 650t#2 | 0.67秒 | 0.67秒 | 0.8秒 | **0.69秒** | - | - |
| 800t#3 | - | - | 0.85秒 | - | 0.79秒 | 0.9秒 |

**重要**: CCHは#650t#1と#650t#2でのみ生産可能

## 残業時間計算 (`calculate_optimal_overtime`)

### 制約

- **在庫上限**: 1000個を超えないように調整
- **残業単位**: 5分刻み
- **最大残業**: 120分

### ロジック

```python
# この直で計画されている品番の生産数も考慮
total_planned = current_shift_planned + good_production

# 在庫上限チェック
if current_stock + total_planned > MAX_STOCK:
    # 残業時間を削減
    while overtime >= 5 and current_stock + good_production > MAX_STOCK:
        overtime -= 5
        total_prod, good_prod = calculate_production(...)
```

## 生産数計算 (`calculate_production`)

### 計算式

```python
# 稼働時間（分）
working_time = BASE_TIME[shift] - stop_time - changeover_time + overtime

# 総生産数（不良品含む）
total_production = floor((working_time / tact) * occupancy_rate)

# 良品数
good_production = floor(total_production * yield_rate)
```

### パラメータ

- `BASE_TIME`: 455分（day）/ 455分（night）
- `tact`: 品番・設備ごとのタクト（秒）
- `occupancy_rate`: 稼働率（93% = 0.93）
- `yield_rate`: 良品率（通常1.0）
- `changeover_time`: 型替え時間（30分、継続生産は0分）

## 型替え時間の削減

### 継続生産の利点

- **型替え時間**: 30分削減
- **生産時間**: 455分 → 485分（残業含む）
- **生産数増加**: 約30分分の生産台数が増加

### 例

```
型替えあり:
  稼働時間 = 455 - 30 = 425分
  生産数 = (425 / 0.8) * 0.93 = 494台

型替えなし（継続生産）:
  稼働時間 = 455分
  生産数 = (455 / 0.8) * 0.93 = 528台

差分: +34台
```

## デバッグログ

ログファイル: `inventory_simulation_log_cover.txt`

### ログ構造

```
================================================================================
【設備と品番のマッピング確認】
================================================================================

【初期在庫】

================================================================================
【2025-10-01 day直】
================================================================================

--- 生産計画（品番選択） ---
  品番緊急度評価（出荷前）:
    CCS【継続可】: 現在4台 - 出荷427台 = 出荷後-423台, 在庫切れまで0直
    POL【継続可】: 現在90台 - 出荷134台 = 出荷後-44台, 在庫切れまで0直
    ...

  【緊急度順割り当て】
    品番:CCS (緊急度:0直)
      前の直の設備状態: #650t#1:POL(未割当), #650t#2:CCS(未割当), ...
      → 設備#650t#2で前の直もCCSを生産していました（継続生産）
    設備#650t#2: CCS を【緊急割り当て】【継続生産】 (...)

--- 生産実行 ---
  設備#650t#2: CCS
    基本時間:455分 - 停止:0分 - 型替:0分 + 残業:120分 = 稼働時間:575分
    タクト:0.8秒, 良品率:1.0, 稼働率:0.93
    総生産:668台, 良品:668台
    在庫: 4 → 672台

--- 出荷処理 ---
  CCS: 672 → 245 (出荷: 427台)

--- 直後の在庫 ---
  CCS: 245 台
```

## 関連ファイル

- **Python**: `management_room/views/production_plan/auto_casting_production_plan.py`
  - メソッド: `_generate_auto_plan_cover()`
  - ヘルパー関数: `evaluate_item_urgency()`, `find_machine_for_item()`

- **モデル**: `management_room/models.py`
  - `CastingItemMachineMap`: 品番×設備のタクト・良品率マッピング
  - `CastingLine`: ライン情報（稼働率など）
  - `CastingMachine`: 設備情報

- **JavaScript**: `static/js/casting_production_plan.js`
  - 自動計画結果の適用処理
  - 動的な設備数対応（`machineCount = machineRows.length / 8`）

## 今後の改善案

- [ ] 継続生産の優先度をさらに最適化
- [ ] 在庫上限を品番ごとに設定可能にする
- [ ] 型替え回数の目標値を設定
- [ ] 残業時間の総量制約を追加
