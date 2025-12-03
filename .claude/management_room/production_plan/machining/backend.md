# 加工バックエンド

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

## 組付ラインと紐づいていない場合の初期値設定

組付ラインと紐づいていない加工ライン（`line.assembly is None`）の場合、AssemblyItemMachiningItemMapの紐づきを元に組付側の出庫数を初期値として設定します。

### 1. 組付生産計画から出庫数を取得

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

### 2. 生産数・出庫数の初期値設定

```python
# 既存データがない場合
assembly_shipment = assembly_shipment_map.get((date, shift, item_name), None)
assembly_production = assembly_shipment  # 生産数 = 出庫数

date_info['shifts'][shift]['items'][item_name] = {
    'production_quantity': assembly_production,
    'shipment': assembly_shipment
}
```

### 3. 残業時間の自動計算

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

## 保存

```python
for date_info in dates_data:
    for shift_name, shift_data in shifts.items():
        for item_name, item_data in items_data.items():
            MachiningStock.objects.update_or_create(
                line_name=line_name,  # 組付けID含まず
                item_name=item_name,
                date=date_obj,
                shift=shift_name,
                defaults={'stock': item_data.get('stock')}
            )
```

ref: `machining_production_plan.py`
