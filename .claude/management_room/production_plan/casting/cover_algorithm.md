# カバーライン自動生産計画アルゴリズム

## 概要

カバーラインの自動生産計画は、**在庫切れを絶対に防ぎつつ、型替えを最小化**することを目的とする。
ヘッドラインとは異なり、金型管理の制約がないため、より柔軟な計画が可能。

## ヘッドラインとの違い

| 項目 | ヘッドライン | カバーライン |
|------|------------|------------|
| 金型管理 | あり（6直制約） | なし |
| 型替え可能品番 | あり | なし（すべての品番で自由に型替え可能） |
| 在庫下限 | なし | **0個（絶対制約）** |
| 在庫上限 | なし | **1000個（絶対制約）** |
| 設備別タクト | なし（品番ごとに統一） | あり（CastingItemMachineMap） |
| 型替え時間 | 90分 | 30分 |

## アルゴリズムの構造

### ファイル構成

- **メソッド**: `_generate_auto_plan_cover()` in `auto_casting_production_plan.py:1274`
- **ヘルパー関数** (メソッド内定義):
  - `calculate_production()`: 生産数計算
  - `calculate_shifts_until_stockout()`: 在庫切れまでの直数計算
  - `evaluate_item_urgency()`: 緊急度評価とソート
  - `find_machine_for_item()`: 設備割り当て
  - `calculate_optimal_overtime()`: 最適残業時間計算

### 定数定義

```python
BASE_TIME = {'day': 455, 'night': 450}  # 基本稼働時間（分）
OVERTIME_MAX = {'day': 120, 'night': 60}  # 残業上限（分）
MIN_STOCK = 0  # 最小在庫（絶対制約）
MAX_STOCK = 1000  # 最大在庫（絶対制約）
SAFETY_THRESHOLD = 50  # 安全在庫レベル（この値以下は危険）
CHANGEOVER_TARGET = 900  # 型替え推奨在庫レベル
CHANGEOVER_READY_STOCK = 900  # 型替え可能在庫レベル
URGENCY_THRESHOLD = 3  # 緊急度閾値（直数）
CHANGEOVER_TIME = 30  # 型替え時間（分）
```

## 処理フロー

各直（day/night）ごとに以下の手順を実行:

```
1. 出荷予定を取得
2. 緊急度評価 (evaluate_item_urgency)
   ├─ 出荷後在庫を計算
   ├─ 在庫切れまでの直数を計算
   ├─ 継続生産可能かチェック
   ├─ 生産可能設備数をカウント（設備制約考慮）
   └─ ソート（在庫マイナス → 継続生産 → 出荷後在庫 → 設備制約 → 緊急度）
3. 2フェーズで品番割り当て
   ├─ フェーズ1: 在庫マイナス品番を絶対優先
   └─ フェーズ2: その他の品番を緊急度順に処理
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

# 継続生産可能かチェック（全設備で確認）
can_continue = any(
    machine_current_item.get(m.id) == item_name
    for m in machines
)

# 生産可能設備数をカウント（未割り当ての設備のみ）
available_machine_count = len([
    m for m in machines
    if m.id not in assigned_machines and f"{item_name}_{m.id}" in item_data
])
```

### ソート順序

品番の処理順序を決定する5段階のソートキー:

1. **第1キー**: 在庫マイナスフラグ（マイナスが最優先）
   - 在庫がマイナスになる品番を絶対優先

2. **第2キー**: `can_continue`（継続生産可能性、継続可=0が優先）
   - 継続生産可能な品番を優先することで型替え回数を削減

3. **第3キー**: `stock_after_delivery`（出荷後在庫、少ない順）
   - マイナスが深刻な順（-423 < -317 < 25）

4. **第4キー**: `available_machine_count`（生産可能設備数、少ない順）
   - 設備制約のある品番（CCHは#1/#2のみなど）を優先

5. **第5キー**: `shifts_until_stockout`（在庫切れまでの直数、少ない順）
   - 0直（この直で在庫切れ）が最優先

```python
urgency_list.sort(key=lambda x: (
    0 if x['stock_after_delivery'] < 0 else 1,  # 在庫マイナス最優先
    0 if x['can_continue'] else 1,              # 継続生産優先
    x['stock_after_delivery'],                  # 在庫不足の深刻度
    x['available_machine_count'],               # 設備制約考慮
    x['shifts_until_stockout']                  # 緊急度
))
```

## 2フェーズ品番割り当てアルゴリズム

### フェーズ1: 在庫マイナス品番の絶対優先処理

在庫がマイナスになる品番を最優先で処理：

```python
for item_info in item_urgency:
    if item_info['stock_after_delivery'] < 0:
        # 既に別の設備に割り当てられているかチェック（重複生産防止）
        if any(plan['item_name'] == item_name for plan in shift_plans):
            continue  # スキップ

        # 設備を探して割り当て
        machine, is_continuation = find_machine_for_item(item_name)
```

**特徴**:
- 在庫マイナス品番は継続生産より優先
- 同一品番の重複生産を防止（1品番=1設備の原則）
- 設備制約も考慮（CCHは#1,2でしか作れない）

### フェーズ2: その他の品番の緊急度順処理

```python
for item_info in item_urgency:
    if item_info['stock_after_delivery'] < 0:
        continue  # フェーズ1で処理済み

    # 重複生産チェック
    if any(plan['item_name'] == item_name for plan in shift_plans):
        continue

    # 生産判定
    if item_info['shifts_until_stockout'] <= URGENCY_THRESHOLD:
        produce = True  # 緊急度が高い
    elif item_info['available_machine_count'] <= 1:
        produce = True  # 設備制約あり
    elif is_continuation:
        produce = True  # 継続生産可能
    else:
        produce = False  # スキップ（型替え削減）
```

## 650t#1と650t#2の割り当て最適化

### 概要

2フェーズ品番割り当て完了後、650t#1と650t#2の品番を入れ替えた方が型替え回数が減る場合、在庫制約を満たす範囲で入れ替えを実施する。

### 実行タイミング

`shift_plans`完成後、生産実行前（`auto_casting_production_plan.py:2377`）

### 最適化ロジック

```python
def optimize_650t_assignment():
    # 1. 650t#1と650t#2のplanを抽出
    # 2. 型替え回数を比較
    current_changeovers = count_changeovers(before_swap)
    swapped_changeovers = count_changeovers(after_swap)

    if swapped_changeovers >= current_changeovers:
        return False  # 入れ替えても改善しない

    # 3. 入れ替え可能かチェック（設備-品番マッピング）
    if not can_produce(item_2, machine_1) or not can_produce(item_1, machine_2):
        return False

    # 4. 入れ替え後の残業時間・生産数を再計算
    optimal_overtime_1, good_prod_1 = recalculate(item_2, machine_1, ...)
    optimal_overtime_2, good_prod_2 = recalculate(item_1, machine_2, ...)

    # 5. 在庫制約チェック
    if 在庫制約違反:
        # 6. 残業時間の組み合わせを全探索（5分刻み）
        for ot1 in range(0, OVERTIME_MAX + 1, 5):
            for ot2 in range(0, OVERTIME_MAX + 1, 5):
                if 制約を満たす:
                    最適な組み合わせを記録

        if 制約を満たす組み合わせが見つからない:
            return False  # 入れ替えをキャンセル

    # 7. 入れ替え実行
    swap(plan_1, plan_2)
    update_changeover_counts()
    return True
```

### 具体例

**問題のケース（7日目）:**

```
7日日勤: #1=POL(7), #2=CCS (前回: #1=CCS, #2=POL(7))
  → 型替え: #1で1回（CCS→POL(7)）、#2で1回（POL(7)→CCS）= 2回

7日夜勤: #1=CCS, #2=POL(7) (前回: #1=POL(7), #2=CCS)
  → 型替え: #1で1回（POL(7)→CCS）、#2で1回（CCS→POL(7)）= 2回
```

**最適化後:**

```
7日日勤: #1=CCS, #2=POL(7) (前回: #1=CCS, #2=POL(7))
  → 型替え: 0回（両方とも継続生産）

7日夜勤: #1=CCS, #2=POL(7) (前回: #1=CCS, #2=POL(7))
  → 型替え: 0回（両方とも継続生産）
```

型替え回数: 4回 → 0回（4回削減）

### 在庫制約の調整

入れ替えによってタクトが変わると生産数が変わるため、在庫制約（0以上、1000以下）を満たせなくなる可能性がある。

**調整方法:**
1. 残業時間の組み合わせを全探索（5分刻み、day:0-120分、night:0-60分）
2. 各組み合わせで在庫を計算し、制約を満たすか確認
3. 制約を満たす組み合わせの中で、最も多く生産できる組み合わせを選択（安全在庫確保）
4. どの組み合わせでも制約を満たせない場合は入れ替えをキャンセル

**計算例:**

```
入れ替え前:
  #1でPOL(7): タクト0.72秒、残業120分 → 798台生産 → 在庫1250台（上限超過）
  #2でCCS: タクト0.8秒、残業120分 → 633台生産 → 在庫841台

入れ替え後（最適残業時間で計算）:
  #1でCCS: タクト0.85秒、残業???分 → ???台生産 → 在庫???台
  #2でPOL(7): タクト0.67秒、残業???分 → ???台生産 → 在庫???台

→ 残業時間を調整して、両方とも0 ≤ 在庫 ≤ 1000を満たすように設定
```

### ログ出力

```
--- 650t#1と650t#2の割り当て最適化 ---
  入れ替え前:
    #1: POL(7) (前回: CCS)
    #2: CCS (前回: POL(7))
    型替え回数: 2回
  入れ替え後:
    #1: CCS (前回: CCS)
    #2: POL(7) (前回: POL(7))
    型替え回数: 0回
  → 型替え回数が 2回減少

  入れ替え後の在庫予測:
    CCS: 現在208台 + 他設備0台 + #1生産650台 = 生産後858台 → 出荷後456台
    POL(7): 現在452台 + 他設備0台 + #2生産750台 = 生産後1202台 → 出荷後860台

  【在庫制約違反を検出】
    - POL(7)の生産後在庫が上限超過: 1202台 > 1000台

  → 残業時間を調整して制約を満たすように再計算

  【調整成功】残業時間を調整して制約を満たしました
    #1の残業: 115分 → CCSを645台生産
    #2の残業: 85分 → POL(7)を680台生産
    CCS: 生産後853台 → 出荷後451台
    POL(7): 生産後1132台 → 出荷後790台

  → 入れ替えを実行します
```

## 設備割り当て (`find_machine_for_item`)

### 優先順位

1. **継続生産**: 前の直で同じ品番を生産していた設備（型替えなし）
   - ただし、在庫が900台以上かつ緊急度が低い場合は型替えを推奨
2. **最速タクト**: タクトが最も小さい（速い）設備

### ロジック

```python
def find_machine_for_item(item_name):
    # 1. 継続生産できる設備を探す
    for machine in machines:
        if machine.id in assigned_machines:
            continue
        if machine_current_item.get(machine.id) == item_name:
            # 在庫が900台以上かつ緊急度が低い場合は型替えを推奨
            if current_stock >= CHANGEOVER_READY_STOCK and shifts_until_stockout > 3:
                continue  # 別の品番を優先
            return machine, True  # 継続生産

    # 2. 最速タクトの設備を探す
    available_machines = [
        m for m in machines
        if m.id not in assigned_machines and f"{item_name}_{m.id}" in item_data
    ]
    if available_machines:
        best_machine = min(available_machines, key=lambda m: item_data[f"{item_name}_{m.id}"]['tact'])
        return best_machine, False

    return None, False
```

### 設備-品番マッピング

品番ごとに生産可能な設備とタクトは異なる（`CastingItemMachineMap`から取得）:

| 設備 | POL | POL(7) | CCS | CCH | CCL | CCL(7) |
|------|-----|--------|-----|-----|-----|--------|
| 650t#1 | 0.67秒 | 0.72秒 | 0.85秒 | 0.72秒 | - | - |
| 650t#2 | 0.67秒 | 0.67秒 | 0.8秒 | **0.69秒** | - | - |
| 800t#3 | - | - | 0.85秒 | - | 0.79秒 | 0.9秒 |

**重要**: CCHは#650t#1と#650t#2でのみ生産可能（設備制約）

## 残業時間計算 (`calculate_optimal_overtime`)

### 制約

- **在庫下限**: 0個を下回らないように調整（安全在庫50台を推奨）
- **在庫上限**: 1000個を超えないように調整
- **残業単位**: 5分刻み
- **最大残業**: day直120分、night直60分

### ロジック

```python
# ケース1: 在庫が安全レベル以下になる場合
if stock_after_delivery + good_production_no_overtime < SAFETY_THRESHOLD:
    # 安全在庫を確保するために必要な残業時間を計算
    # 1000を超えない範囲で最大化

# ケース2: 継続生産の場合、在庫を900台に近づける
if is_continuation and changeover_time == 0:
    if stock_after_delivery < CHANGEOVER_TARGET:
        # 900台に近づくまで最大残業
        # これにより型替え時に在庫が十分にある状態にする

# ケース3: その他の場合、1000を超えないように調整
```

### 型替え効率最大化

継続生産中は在庫を900台まで積み上げることで、型替え後にしばらく生産不要な状態を作る：

```
継続生産1日目: 在庫200台 → 最大残業で500台生産 → 在庫700台
継続生産2日目: 在庫700台 → 最大残業で300台生産 → 在庫900台
継続生産3日目: 在庫900台 → 型替え推奨 → 別の品番へ
（型替え後、数日間は生産不要）
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

- `BASE_TIME`: 455分（day）/ 450分（night）
- `tact`: 品番・設備ごとのタクト（秒）
- `occupancy_rate`: 稼働率（93% = 0.93）
- `yield_rate`: 良品率（通常1.0）
- `changeover_time`: 型替え時間（30分、継続生産は0分）

## 型替え時間の削減戦略

### 1. 継続生産の優先

- **型替え時間**: 30分削減
- **生産時間**: 455分 → 485分（残業含む）
- **生産数増加**: 約30分分の生産台数が増加

### 2. 同一品番の重複生産防止

同じ直で複数の設備で同じ品番を生産することを防止：

```
NG例（改善前）:
  6日日勤: #2でCCS
  6日夜勤: #1でCCS、#2でCCH ← #2は型替え発生

OK例（改善後）:
  6日日勤: #2でCCS
  6日夜勤: #2でCCS継続 ← 型替えなし
```

### 3. 在庫900台での型替え推奨

在庫が900台に達した品番は型替えを推奨し、別の品番を優先：

```python
if current_stock >= CHANGEOVER_READY_STOCK and shifts_until_stockout > 3:
    # 在庫が十分で緊急度が低い場合、型替えを推奨
    continue  # 別の品番を優先
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
    CCS【継続可】[設備:3台で生産可]: 現在4台 - 出荷427台 = 出荷後-423台, 在庫切れまで0直
    POL【継続可】[設備:2台で生産可]: 現在90台 - 出荷134台 = 出荷後-44台, 在庫切れまで0直

  【2フェーズ品番割り当て（在庫マイナス最優先）】

  --- フェーズ1: 在庫マイナス品番 ---
    品番:CCS (出荷後在庫:-423台, 生産可能設備:3台)
      → 生産決定: 在庫マイナス（最優先）
      → 設備#650t#2で継続生産（型替えなし）
  設備#650t#2: CCS を【在庫マイナス最優先割り当て】

  --- フェーズ2: その他の品番（緊急度順） ---
    品番:POL(7) (緊急度:0直, 生産可能設備:2台)
      → 生産決定: 継続生産可能（型替えなし）
      → 設備#650t#1で継続生産（型替えなし）

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

================================================================================
【最終在庫状態サマリー】
================================================================================

  CCH: 360台
  CCL: 808台
  CCL(7): 255台
  CCS: 245台
  POL: 754台
  POL(7): 947台

✓ すべての品番が適正在庫範囲内です。

================================================================================
【型替え回数統計】
================================================================================

  総型替え回数: 15回

  設備別型替え回数:
    650t#1: 5回
    650t#2: 6回
    800t#3: 4回
```

## 関連ファイル

- **Python**: `management_room/views/production_plan/auto_casting_production_plan.py`
  - メソッド: `_generate_auto_plan_cover()` (1274行目～)
  - ヘルパー関数:
    - `calculate_production()`: 生産数計算
    - `calculate_shifts_until_stockout()`: 在庫切れまでの直数計算
    - `evaluate_item_urgency()`: 緊急度評価
    - `find_machine_for_item()`: 設備割り当て
    - `calculate_optimal_overtime()`: 残業時間計算

- **モデル**: `management_room/models.py`
  - `CastingItemMachineMap`: 品番×設備のタクト・良品率マッピング
  - `CastingLine`: ライン情報（稼働率など）
  - `CastingMachine`: 設備情報

- **JavaScript**: `static/js/casting_production_plan.js`
  - 自動計画結果の適用処理

## 改善履歴

### v1.0 - 基本アルゴリズム
- 在庫0-1000制約の実装
- 緊急度評価による品番割り当て
- 継続生産優先

### v2.0 - 設備制約対応
- 生産可能設備数のカウント
- 設備制約のある品番を優先
- 同一品番の重複生産防止

### v3.0 - 型替え最適化
- 2フェーズ品番割り当てアルゴリズム
- 在庫900台での型替え推奨
- 継続生産中の在庫積み上げ戦略

## 今後の改善案

- [ ] 品番ごとの在庫上限設定（現在は全品番共通で1000）
- [ ] 型替え回数の目標値設定
- [ ] 残業時間の総量制約
- [ ] 複数月をまたいだ最適化
