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
