# CVT生産計画 バックエンド仕様

## ビューファイル

`management_room/views/production_plan/cvt_production_plan.py`

## クラス構成

### CVTProductionPlanView

**継承**: `ManagementRoomPermissionMixin`, `View`

**役割**: CVT生産計画の表示と保存

## GET処理

### パラメータ

- `year`: 対象年（デフォルト: 現在年）
- `month`: 対象月（デフォルト: 現在月）
- `line`: CVTライン ID（デフォルト: 最初のアクティブライン）

### データ取得フロー

```python
# 1. 基本データ取得
date_list = days_in_month_dates(year, month)
line = CVTLine.objects.get(id=line_id)
item_names = CVTItem.objects.filter(line=line, active=True)
machine_list = CVTMachine.objects.filter(line=line, active=True)

# 2. 生産計画データ取得
plans = DailyMachineCVTProductionPlan.objects.filter(
    line=line,
    date__gte=start_date,
    date__lte=end_date
).select_related('machine', 'production_item')

# 3. 在庫データ取得
stock_plans = DailyCVTProductionPlan.objects.filter(
    line=line,
    date__gte=start_date,
    date__lte=end_date
).select_related('production_item')

# 4. 前月在庫取得
prev_month_stock_plans = DailyCVTProductionPlan.objects.filter(
    line=line,
    date=prev_month_last_date,
    shift='night'
).select_related('production_item')
```

### データ構造化

#### dates_data構造

```python
dates_data = [
    {
        'date': date(2024, 12, 1),
        'weekday': 0,  # 0=月, 1=火, ...
        'is_weekend': False,
        'occupancy_rate': 95.0,  # パーセント表示
        'has_weekend_work': False,
        'is_regular_hours': False,
        'shifts': {
            'day': {
                'items': {
                    'SHC': {
                        'inventory': 100,
                        'production': 20,  # フロントエンドで計算
                        'stock_adjustment': 0
                    },
                    ...
                },
                'machines': {
                    '#1': {
                        'machine_id': 1,
                        'items': ['SHC', 'F/CTC', 'i-STM'],  # 選択可能品番
                        'stop_time': 0,
                        'overtime': 60,
                        'selected_item': 'SHC'  # 選択中の品番
                    },
                    ...
                }
            },
            'night': { ... }
        }
    },
    ...
]
```

#### item_data構造

```python
item_data = {
    'SHC': {
        '#1': {
            'tact': 1.04,                  # タクト（分）
            'yield_rate': 0.99,            # 良品率（0.0～1.0）
            'molten_metal_usage': 6.0      # 溶湯使用量（kg）
        },
        '#2': { ... },
        ...
    },
    'F/CTC': { ... },
    ...
}
```

### コンテキスト

```python
context = {
    'year': year,
    'month': month,
    'line': line,
    'dates_data': dates_data,
    'item_names': item_names,
    'machines': machine_list,
    'item_data_json': json.dumps(item_data),
    'previous_month_inventory_json': json.dumps(previous_month_inventory),
    'lines': lines_list,
    'inventory_comparison': inventory_comparison,
    'item_total_rows': len(item_names) * 2,
    'machine_total_rows': len(machine_list) * 2,
}
```

## POST処理

### リクエストデータ

```json
{
    "plan_data": [
        {
            "type": "production_plan",
            "date_index": 0,
            "shift": "day",
            "machine_index": 0,
            "item_name": "SHC",
            "mold_count": 0  // CVTでは常に0
        },
        {
            "type": "stop_time",
            "date_index": 0,
            "shift": "day",
            "machine_index": 0,
            "stop_time": 30
        },
        {
            "type": "overtime",
            "date_index": 0,
            "shift": "day",
            "machine_index": 0,
            "overtime": 60
        },
        {
            "type": "mold_change",
            "date_index": 0,
            "shift": "day",
            "machine_index": 0,
            "mold_change": 30
        },
        {
            "type": "inventory",
            "date_index": 0,
            "shift": "day",
            "item_name": "SHC",
            "stock": 100
        },
        {
            "type": "stock_adjustment",
            "date_index": 0,
            "shift": "day",
            "item_name": "SHC",
            "stock_adjustment": 5
        }
    ],
    "weekends_to_delete": [5, 6],
    "occupancy_rate_data": [
        {"date_index": 0, "occupancy_rate": 0.95}
    ],
    "regular_working_hours_data": [
        {"date_index": 3, "regular_working_hours": true}
    ]
}
```

### 保存ロジック

```python
# 1. データをグループ化
grouped_data = {}  # CVT機ごとのデータ
item_plan_data = {}  # 品番ごとの在庫データ

# 2. DailyMachineCVTProductionPlan保存
for key, data in grouped_data.items():
    DailyMachineCVTProductionPlan.objects.update_or_create(
        line=line,
        machine=machine,
        date=date,
        shift=shift,
        production_item=production_item,
        defaults={
            'stop_time': stop_time,
            'overtime': overtime,
            'regular_working_hours': regular_working_hours,
            'occupancy_rate': occupancy_rate,
            'last_updated_user': request.user.username
        }
    )

# 3. DailyCVTProductionPlan保存
for key, plan_item in item_plan_data.items():
    DailyCVTProductionPlan.objects.update_or_create(
        line=line,
        production_item=production_item,
        date=date,
        shift=shift,
        defaults={
            'stock': stock,
            'stock_adjustment': stock_adjustment,
            'last_updated_user': request.user.username
        }
    )

# 4. 休日出勤削除
for date_index in weekends_to_delete:
    DailyMachineCVTProductionPlan.objects.filter(
        line=line,
        date=date,
        shift='day'
    ).delete()
```

### 品番変更時の処理

同じCVT機・日付・シフトで品番が変更された場合、他の品番のレコードを削除：

```python
if production_item:
    # 同じCVT機・日付・シフトの他の品番のレコードを削除
    DailyMachineCVTProductionPlan.objects.filter(
        line=line,
        machine=machine,
        date=date,
        shift=shift
    ).exclude(
        production_item=production_item
    ).delete()

    # 選択された品番のレコードを作成または更新
    DailyMachineCVTProductionPlan.objects.update_or_create(...)
```

## レスポンス

### 成功時

```json
{
    "status": "success",
    "message": "123件のデータを保存、5件のデータを削除しました"
}
```

### エラー時

```json
{
    "status": "error",
    "message": "エラーメッセージ"
}
```

## 最適化ポイント

### クエリ最適化

```python
# ❌ N+1問題
for plan in plans:
    machine_name = plan.machine.name  # 毎回クエリ発行

# ✅ select_related使用
plans = DailyMachineCVTProductionPlan.objects.filter(
    ...
).select_related('machine', 'production_item')
```

### データキャッシュ

```python
# 辞書化してO(1)アクセス
plans_dict = {}
for plan in plans:
    key = (plan.machine.id, plan.date, plan.shift)
    plans_dict[key] = plan

# 使用時
plan = plans_dict.get((machine_id, date, shift))
```

## 注意点

### CVT特有の処理

1. **金型カウント管理なし**
   ```python
   # CVTでは mold_count は常に 0
   defaults = {
       'mold_count': 0,  # 保存時は0固定
       ...
   }
   ```

2. **金型交換時間は手動入力**
   ```python
   # mold_change は手動入力値をそのまま保存
   defaults = {
       'mold_change': mold_change,  # ユーザー入力値
       ...
   }
   ```

3. **ライン種別判定不要**
   ```python
   # CVTでは is_head_line, is_block_line などの判定不要
   # テンプレートにも渡さない
   ```

## 自動生成ロジック（auto_cvt_production_plan.py）

### ファイル

`management_room/views/production_plan/auto_cvt_production_plan.py`

### 関数: `generate_cvt_production_plan_2phase()`

CVT生産計画を自動生成する関数。在庫切れを防ぎながら、型替え回数を最小化する。

### アルゴリズム概要

#### 2フェーズ割り当て方式

**フェーズ1: 在庫マイナス品番の最優先割り当て**
- 出荷後在庫がマイナスになる品番を最優先で割り当て
- 在庫不足を確実に防止

**フェーズ2: その他の品番を緊急度順に割り当て**
- 未割り当て設備がある限り、最も緊急度の高い品番を優先的に割り当て
- 同じ品番を複数設備に割り当て可能（在庫不足対策）

### 品番選択ロジック

#### 優先順位（フェーズ2）

1. **月末予測在庫の下限チェック** → 下限を下回るなら**最優先で生産**
2. **月末予測在庫の上限チェック** → 上限超過なら**スキップ**（緊急度が高い場合を除く）
3. **緊急度が高い**（在庫切れまで3直以下）→ **必ず生産**
4. **継続生産可能** かつ 在庫が900台未満 → 生産
5. 在庫が900台未満 → 生産
6. 在庫が900台以上 → **スキップ**（緊急度が低い場合）

#### 月末予測在庫の上限・下限

品番ごとに月末予測在庫の上限・下限を設定し、過剰生産と在庫不足を防止：

```python
# 月末在庫上限の計算
target_stock = optimal_inventory.get(item_name, 600)
if target_stock < 600:
    end_of_month_upper_limit = target_stock * 1.5
else:
    end_of_month_upper_limit = target_stock + 200

# 月末予測在庫の計算
predicted_end_stock = (current_stock + estimated_production - remaining_deliveries)

# 上限超過チェック
if predicted_end_stock > end_of_month_upper_limit:
    if urgency > URGENCY_THRESHOLD:
        return False, "月末予測在庫が上限超過"
```

**例**：
- CTM（適正在庫700台）: 上限 = 700 + 200 = **900台**
- T/CTC（適正在庫100台）: 上限 = 100 × 1.5 = **150台**
- F/CTM（適正在庫400台）: 上限 = 400 × 1.5 = **600台**

#### 判定関数

```python
def should_produce_item(item_info, is_continuation, machine_id):
    """品番を生産すべきかを判定する"""
    # 1. 月末予測在庫の上限チェック
    predicted_end_stock = (current_stock + estimated_production - remaining_deliveries)
    if predicted_end_stock > end_of_month_upper_limit:
        if urgency <= URGENCY_THRESHOLD:
            return True  # 緊急度が高いので生産
        else:
            return False  # 月末在庫上限超過でスキップ

    # 2. 通常の判定
    is_overstocked = item_info['current_stock'] >= CHANGEOVER_READY_STOCK

    if item_info['shifts_until_stockout'] <= URGENCY_THRESHOLD:
        return True, "緊急度が高い"
    elif is_continuation and not is_overstocked:
        return True, "継続生産可能（型替えなし）"
    elif not is_overstocked:
        return True, "在庫が不足する可能性あり"
    else:
        return False, f"在庫過剰（{item_info['current_stock']}台）で緊急度も低い"
```

### 設備選択ロジック

#### find_machine_for_item()

品番に最適な設備を選択：

1. **同じ設備で継続生産可能か**（型替えなし）
2. **同じグループ内の別の設備で継続生産可能か**（設備#1と#2の入れ替え）
3. **未割り当ての設備から最速タクトを選択**

```python
def find_machine_for_item(item_name):
    """品番に最適な設備を探す"""
    # 1. 同じ設備で継続生産可能かチェック
    for machine in machines:
        if machine.id in assigned_machines:
            continue
        if machine_current_item.get(machine.id) == item_name:
            return machine, True  # 継続生産

    # 2. グループ内で継続生産可能かチェック
    # （設備グループ: GROUP_A = ['650t#1', '650t#2']）

    # 3. 最速タクトの設備を選択
    best_machine = min(available_machines,
                      key=lambda m: item_data[f"{item_name}_{m.id}"]['tact'])
    return best_machine, False
```

### 動的な在庫・緊急度更新

同じ直で複数設備に品番を割り当てる際、2台目以降は更新された在庫で評価：

```python
def update_item_urgency_info(item_name, good_prod):
    """品番の緊急度情報を更新する"""
    temp_stock = inventory.get(item_name, 0) + good_prod

    for i, info in enumerate(item_urgency):
        if info['item_name'] == item_name:
            # 現在在庫を更新
            item_urgency[i]['current_stock'] = temp_stock
            # 在庫切れまでの直数を再計算
            item_urgency[i]['shifts_until_stockout'] = calculate_shifts_until_stockout(...)
            # 生産可能な未割り当て設備数を再計算
            item_urgency[i]['available_machine_count'] = ...
```

### メインループ（リファクタリング後）

```python
while len(assigned_machines) < len(machines):
    # 次に生産すべき品番を選択
    item_info, machine, is_continuation, reason = select_next_item_to_produce()

    if item_info is None:
        # 残りの品番は全て在庫十分
        break

    # 品番を設備に割り当てて生産計画を作成
    assign_item_to_machine(item_info, machine, is_continuation)
```

### リファクタリング構造

#### 6つの責務別関数

1. **`should_produce_item()`**: 品番を生産すべきかを判定
2. **`has_available_machine_for_item()`**: 生産可能な未割り当て設備があるかチェック
3. **`select_next_item_to_produce()`**: 次に生産すべき品番を選択
4. **`update_item_urgency_info()`**: 品番の緊急度情報を動的に更新
5. **`calculate_changeover_time()`**: 型替え時間を計算
6. **`assign_item_to_machine()`**: 品番を設備に割り当てて生産計画を作成

### パラメータ

```python
CHANGEOVER_READY_STOCK = 900   # 型替え検討可能な在庫レベル
URGENCY_THRESHOLD = 3          # 緊急度閾値（在庫切れまでの直数）
CHANGEOVER_TIME = 30           # 型替え時間（分）
CHANGEOVER_TARGET = 900        # 継続生産時の目標在庫レベル
SAFETY_THRESHOLD = 50          # 安全在庫レベル
```

### 残業時間の最適化

月末時点で各品番が適正在庫に近づくように残業時間を最適化：

```python
def calculate_optimal_overtime(item_name, machine_id, shift, ...):
    """月末予測在庫を考慮した残業時間の最適化"""
    target_stock = optimal_inventory.get(item_name, 600)  # 品番ごとの適正在庫

    # ケース1: 安全在庫確保（緊急）
    # 最小限の残業で安全在庫を確保しつつ、月末予測在庫も考慮
    if stock_after_delivery + good_production_no_overtime < SAFETY_THRESHOLD:
        # 安全在庫確保に必要な最小残業時間を計算
        # その上で、月末予測在庫が適正在庫に最も近い残業時間を選択
        for overtime in range(min_overtime, OVERTIME_MAX[shift] + 1, 5):
            predicted_end_stock = stock_after_production - future_deliveries
            deviation = abs(predicted_end_stock - target_stock)
            if deviation < best_deviation:
                best_overtime = overtime

    # ケース2: 通常の最適化
    # 月末予測在庫が適正在庫に最も近い残業時間を選択
    for overtime in range(0, OVERTIME_MAX[shift] + 1, 5):
        predicted_end_stock = stock_after_production - future_deliveries
        deviation = abs(predicted_end_stock - target_stock)

        # 継続生産の場合、900台目標も考慮
        # ただし、月末予測在庫が適正在庫±100以内の場合のみ
        if is_continuation and abs(predicted_end_stock - target_stock) <= 100:
            if stock_after_production >= CHANGEOVER_TARGET:
                return overtime

        if deviation < best_deviation:
            best_overtime = overtime
```

**効果**:
- ✅ 月末に過剰在庫を防止
- ✅ 残業時間を削減
- ✅ 品番ごとの適正在庫を維持
- ✅ 緊急時も月末予測在庫を考慮

### 月末在庫補正処理

生産計画生成後、月末時点で適正在庫から大きく乖離している品番を補正：

```python
ADJUSTMENT_THRESHOLD = 200  # ±200台以上の乖離で補正対象
```

#### 補正アルゴリズム

**フェーズ1: 在庫過剰品番の生産削減**
```python
# 最終週（7日間）の該当品番の計画を逆順で処理
for item in items_to_reduce:
    # 残業時間を削減（例: 120分 → 0分）
    # 削減目標達成まで繰り返し
    actual_reduction += (current_production - no_overtime_production)
```

**フェーズ2: 在庫不足品番の生産増加**
```python
# 最終週の該当品番の計画を逆順で処理
for item in items_to_increase:
    # 残業時間を最大まで追加（例: 60分 → 120分）
    # 増加目標達成まで繰り返し
    actual_increase += (max_overtime_production - current_production)
```

**フェーズ3: 補正後の在庫シミュレーション**
```python
# 在庫をリセットして全期間を再シミュレーション
# 補正後の最終在庫が適正在庫に近づいているか確認
```

**補正結果の評価**:
- ✅ 乖離 ≤ 100台: 適正範囲
- ⚠️ 乖離 > 100台: まだ乖離あり
- ❌ 乖離 > 200台: まだ大きく乖離

**効果**:
- ✅ 月末在庫過剰を防止
- ✅ 月末在庫不足を防止
- ✅ 残業時間の無駄を削減
- ✅ 適正在庫に基づく最適化

### ログ出力

詳細なシミュレーションログを出力：

```
inventory_simulation_log_cvt.txt
```

- 品番緊急度評価
- 設備割り当て決定理由
- 在庫シミュレーション
- 月末在庫補正処理
- 補正後の在庫状態
- 型替え回数統計

### 返り値

```python
{
    'plans': [
        {
            'machine_id': 22,
            'machine_name': '#1',
            'date': '2025-10-01',
            'shift': 'day',
            'item_name': 'CTM',
            'overtime': 120,
            'mold_count': 0,  # CVTでは常に0
            'changeover_time': 30
        },
        ...
    ],
    'unused_molds': []  # CVTでは金型管理なし
}
```

## 関連ファイル

- [フロントエンド仕様](frontend.md)
- [データモデル仕様](overview.md#データモデル)
- [在庫管理共通仕様](../common/stock_management.md)
