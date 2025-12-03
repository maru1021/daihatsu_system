# 加工バックエンド

## アーキテクチャ概要

加工生産計画では、**出庫数と在庫数はDBに保存せず、常にフロントエンドで計算**します。これにより、組付けの生産計画変更がリアルタイムに反映されます。

### データフロー

```
組付け生産計画 (DailyAssemblyProductionPlan)
  ↓ リアルタイム計算（GET時）
出庫数 (_get_shipment_for_item)
  ↓ 複数ライン時は残業均等化
振り分け後出庫数 (allocated_shipment_map)
  ↓ フロントエンドで計算
在庫数 (前月末在庫 + 生産数 - 出庫数)
  ↓ 画面表示
加工生産計画画面
  ↓ 保存時（POST）
在庫データのみDB保存 (MachiningStock)
  ↓ 翌月の計算で使用
前月末在庫
```

### 保存される/されないデータ

| データ | GET時 | POST時 | 用途 |
|--------|------|--------|------|
| 出庫数 (shipment) | 組付けから計算 | 保存しない | 組付け生産数のリアルタイム反映 |
| 在庫数 (stock) | フロントエンドで計算 | 保存する | 翌月の前月末在庫として使用 |
| 生産数 (production_quantity) | DBから取得 | 保存する | ユーザー入力値 |

## データ取得

```python
line_name = request.GET.get('line_name')
lines = MachiningLine.objects.select_related('assembly').filter(
    name=line_name, active=True
).order_by('assembly__order', 'order')

for line in lines:
    items = MachiningItem.objects.filter(line=line, active=True).order_by('order')
    lines_data.append({
        'line': line,
        'item_names': [item.name for item in items],
        'item_data': item_data_json,
    })
```

## 前月末在庫

```python
previous_month_stocks = {}
for item_name in all_item_names:
    last_stock = MachiningStock.objects.filter(
        line_name=line_name, item_name=item_name, date__lt=first_day_of_month
    ).order_by('-id').first()
    previous_month_stocks[item_name] = last_stock.stock if last_stock else 0
```

## 出庫数と在庫数の計算

**重要**:
- `DailyMachiningProductionPlan.shipment`フィールドは存在しますが、**保存・読み込みには使用しません**。出庫数は常に組付けの生産数から計算されます。
- `MachiningStock.stock`フィールドは**読み込みには使用しませんが、保存します**。在庫はフロントエンドで計算され、翌月の前月末在庫として使用するためDBに保存されます。

### 出庫数計算メソッド (`_get_shipment_for_item`)

```python
def _get_shipment_for_item(self, line, date, shift, item_name, has_multiple_lines,
                            allocated_shipment_map, assembly_shipment_map):
    """
    指定された品番の出庫数を取得（組付けの生産数から計算）

    Returns:
        int or None: 出庫数
    """
    # 複数ラインの場合は振り分けマップから取得
    if has_multiple_lines:
        alloc_key = (line.id, date, shift, item_name)
        return allocated_shipment_map.get(alloc_key, None)
    # 単一ラインの場合は全量を使用
    else:
        shipment_key = (date, shift, item_name)
        return assembly_shipment_map.get(shipment_key, None)
```

**使用箇所**: GET処理で既存データの有無に関わらず、常にこのメソッドで出庫数を計算します。

## 複数ラインへの振り分けと初期値設定

複数のMachiningLineがある場合、組付側の出庫数を取得し、残業時間が均等になるように自動振り分けします。

### アーキテクチャ

```python
# メインメソッド
def get(self, request):
    # 1. 組付側出庫数取得
    machining_to_assembly_map, assembly_plans_map, assembly_shipment_map =
        self._get_assembly_shipment_data(lines, date_list, all_item_names)

    # 2. 複数ラインの場合、残業均等化で振り分け
    if has_multiple_lines:
        allocated_shipment_map = self._allocate_shipment_to_minimize_overtime(...)

    # 3. 各品番の出庫数を計算（_get_shipment_for_item）
    # 4. 振り分け結果を初期値として設定
    # 5. 残業時間を計算
```

### 1. 組付生産計画から出庫数を取得 (`_get_assembly_shipment_data`)

```python
has_assembly_link = line.assembly is not None
assembly_shipment_map = {}  # {(date, shift, item_name): shipment}

if not has_assembly_link:
    # AssemblyItemMachiningItemMapから紐づきを取得
    assembly_mappings = AssemblyItemMachiningItemMap.objects.filter(
        machining_item__in=machining_items_obj, active=True
    ).select_related('assembly_item', 'assembly_item__line', 'machining_item')

    machining_to_assembly_map = {}  # {machining_name: [(assembly_name, assembly_line_id)]}
    for mapping in assembly_mappings:
        machining_name = mapping.machining_item.name
        assembly_name = mapping.assembly_item.name
        assembly_line_id = mapping.assembly_item.line_id
        if machining_name not in machining_to_assembly_map:
            machining_to_assembly_map[machining_name] = []
        machining_to_assembly_map[machining_name].append((assembly_name, assembly_line_id))

    # 組付生産計画から出庫数を取得
    assembly_plans = DailyAssenblyProductionPlan.objects.filter(
        date__gte=date_list[0], date__lte=date_list[-1],
        production_item__name__in=assembly_item_names
    ).select_related('production_item', 'line')

    # 各加工品番について組付側の生産数を合計
    for date in date_list:
        for shift in ['day', 'night']:
            for item_name in item_names:
                total_assembly_shipment = 0
                assembly_items = machining_to_assembly_map.get(item_name, [])
                for assembly_item_name, assembly_line_id in assembly_items:
                    key = (date, shift, assembly_line_id, assembly_item_name)
                    if key in assembly_plans_map:
                        assembly_plan = assembly_plans_map[key]
                        total_assembly_shipment += assembly_plan.production_quantity or 0

                if total_assembly_shipment > 0:
                    assembly_shipment_map[(date, shift, item_name)] = total_assembly_shipment
```

### 2. 残業時間均等化で振り分け (`_allocate_shipment_to_minimize_overtime`)

複数ラインがある場合、品番を固定品番と柔軟な品番に分類し、残業時間が均等になるように割り振ります。

#### 2-1. 品番の分類 (`_classify_items`)

```python
for item_name in all_item_names:
    # この品番を作れるラインを取得
    available_lines = [各ラインでこの品番が作れるか]

    if len(available_lines) == 1:
        # 固定品番（1ラインでしか作れない）
        fixed_items.append(...)
    elif len(available_lines) > 1:
        # 柔軟な品番（複数ラインで作れる）
        flexible_items.append(...)
```

#### 2-2. 固定品番の割り当て (`_allocate_fixed_items`)

```python
for item in fixed_items:
    # そのラインに全量を割り当て
    allocated_shipment_map[(line_id, date, shift, item_name)] = total_shipment

    # ライン状態を更新
    line_status[line_id]['current_production'] += total_shipment
    line_status[line_id]['current_required_time'] += total_shipment * tact
    line_status[line_id]['current_overtime'] = max(0, required_time - available_time)
```

#### 2-3. 柔軟な品番の均等割り当て (`_allocate_flexible_items`)

固定品番の割り当て後、柔軟な品番を1個ずつ残業時間差が最小になるラインに割り当てます。

```python
for item in flexible_items:
    remaining = item['total_shipment']

    while remaining > 0:
        # 各ラインに割り振った場合の残業時間差を計算
        for line_id in available_lines:
            new_overtime = max(0, (current_time + tact) - available_time)

            # 他のラインとの残業時間の最大差を計算
            max_diff = max(abs(new_overtime - other_overtime) for other_line)

        # 差が最小になるラインを選択
        target_line = 残業時間差が最小のライン

        # 1個割り当て
        allocated_shipment_map[(target_line, date, shift, item_name)] += 1

        # ライン状態を更新
        line_status[target_line]['current_production'] += 1
        line_status[target_line]['current_required_time'] += tact
        line_status[target_line]['current_overtime'] = ...

        remaining -= 1
```

**アルゴリズムの特徴:**
- 固定品番を先に割り当てることで、制約を満たす
- 柔軟な品番は1個ずつ、他のラインとの残業時間差が最小になるラインを選択
- 貪欲法により、各ステップで最適な選択をする
- 結果として、全ラインの残業時間が均等になる

### 3. 生産数・出庫数の初期値設定

```python
# 出庫数は常に組付けから計算（_get_shipment_for_item）
allocated_qty = self._get_shipment_for_item(
    line, date, shift, item_name, has_multiple_lines,
    allocated_shipment_map, assembly_shipment_map
)

# 生産数は既存データがあればDBから取得、なければ0
if key in plans_map:
    production_qty = plans_map[key].production_quantity if plans_map[key].production_quantity is not None else 0
else:
    production_qty = 0

date_info['shifts'][shift]['items'][item_name] = {
    'production_quantity': production_qty,
    'shipment': allocated_qty  # 常に組付けから計算
}
```

**重要な変更**:
- 生産数は常にDBから取得し、データがない場合は0を設定
- 出庫数は常に組付けの生産数から計算され、上位工程の変更がリアルタイムに反映される

### 4. 残業時間の自動計算 (`_calculate_overtime_for_dates`)

```python
if not has_assembly_link:
    REGULAR_TIME_DAY = 455  # 日勤定時時間（分）
    REGULAR_TIME_NIGHT = 450  # 夜勤定時時間（分）
    OVERTIME_ROUND_MINUTES = 5

    for date_info in dates_data:
        for shift in ['day', 'night']:
            # この直の全品番の生産数を合計
            total_production = sum(
                item.get('production_quantity', 0)
                for item in date_info['shifts'][shift]['items'].values()
                if item.get('production_quantity') is not None
            )

            if total_production == 0:
                date_info['shifts'][shift]['overtime'] = 0
                continue

            # タクトと稼働率を取得
            tact = line.tact if line.tact else 0
            occupancy_rate = (date_info['occupancy_rate'] / 100) if date_info['occupancy_rate'] else 0

            if tact == 0 or occupancy_rate == 0:
                date_info['shifts'][shift]['overtime'] = 0
                continue

            # 残業時間を計算
            regular_time = REGULAR_TIME_DAY if shift == 'day' else REGULAR_TIME_NIGHT
            stop_time = date_info['shifts'][shift].get('stop_time', 0)

            required_time = total_production * tact
            available_time = (regular_time - stop_time) * occupancy_rate
            overtime_minutes = max(0, required_time - available_time)

            # 5分刻みに切り上げ
            overtime = int((overtime_minutes + OVERTIME_ROUND_MINUTES - 1) // OVERTIME_ROUND_MINUTES * OVERTIME_ROUND_MINUTES)
            date_info['shifts'][shift]['overtime'] = overtime
```

**計算ロジック:**
- 必要時間 = 全品番の生産数合計 × タクト
- 使用可能時間 = (定時時間 - 計画停止) × 稼働率
- 残業時間 = max(0, 必要時間 - 使用可能時間) を5分刻みで切り上げ

## 保存処理（POST）

**重要**:
- 出庫数 (`shipment`) は保存しません（常に組付けから計算）
- 在庫数 (`stock`) は保存します（翌月の前月末在庫として使用）

### 加工生産計画の保存

```python
for item_name, item_data in items_data.items():
    production_quantity = item_data.get('production_quantity', 0)
    # 出庫数は保存しない（常に組付けから計算）

    DailyMachiningProductionPlan.objects.update_or_create(
        line=line,
        production_item_id=item_pk,
        date=date_obj,
        shift=shift_name,
        defaults={
            'production_quantity': production_quantity,
            'shipment': None,  # 保存しない
            'stop_time': stop_time,
            'overtime': overtime,
            'occupancy_rate': occupancy_rate,
            'regular_working_hours': regular_working_hours,
            'last_updated_user': username
        }
    )
```

### 在庫データの保存

在庫はフロントエンドで計算された値をDBに保存します。翌月の前月末在庫として使用されます。

```python
# ★重要: 在庫はフロントエンドで計算され、翌月の前月末在庫として使用するためDBに保存
for date_info in dates_data:
    for shift_name, shift_data in shifts.items():
        for item_name, item_data in items_data.items():
            stock_value = item_data.get('stock')

            if stock_value is None:
                continue

            MachiningStock.objects.update_or_create(
                line_name=line_name,  # 組付けID含まず
                item_name=item_name,
                date=date_obj,
                shift=shift_name,
                defaults={
                    'stock': stock_value,
                    'last_updated_user': username
                }
            )
```

### bulk_update時の注意

```python
# shipmentフィールドは更新対象から除外
DailyMachiningProductionPlan.objects.bulk_update(
    total_plans_to_update,
    ['production_quantity', 'stop_time', 'overtime', 'occupancy_rate',
     'regular_working_hours', 'last_updated_user']
    # 'shipment'は含めない
)
```

ref: `machining_production_plan.py`
