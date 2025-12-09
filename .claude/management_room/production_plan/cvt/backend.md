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

## 関連ファイル

- [フロントエンド仕様](frontend.md)
- [データモデル仕様](overview.md#データモデル)
- [在庫管理共通仕様](../common/stock_management.md)
