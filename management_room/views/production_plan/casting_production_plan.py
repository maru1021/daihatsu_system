from management_room.models import DailyMachineCastingProductionPlan, DailyCastingProductionPlan, CastingItem, CastingItemMachineMap, MachiningItemCastingItemMap, DailyMachiningProductionPlan
from manufacturing.models import CastingLine, CastingMachine
from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.utils.decorators import method_decorator
from datetime import datetime, timedelta, date
from dateutil.relativedelta import relativedelta
import json
import calendar
import math
from utils.days_in_month_dates import days_in_month_dates

class CastingProductionPlanView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/casting_production_plan.html'

    def get(self, request, *args, **kwargs):
        if request.GET.get('year') and request.GET.get('month'):
            year = int(request.GET.get('year'))
            month = int(request.GET.get('month'))
        else:
            year = datetime.now().year
            month = datetime.now().month

        # 対象月の日付リストを作成（加工生産計画と同じ関数を使用）
        date_list = days_in_month_dates(year, month)
        start_date = date_list[0]
        end_date = date_list[-1]

        # ヘッドラインを取得
        if request.GET.get('line'):
            line = CastingLine.objects.get(id=request.GET.get('line'))
        else:
            line = CastingLine.objects.get(name='ヘッド')

        # 品番を取得（一覧から重複なし）
        items = CastingItem.objects.filter(line=line, active=True).values('name').distinct().order_by('name')
        item_names = [item['name'] for item in items]

        # 鋳造機を取得
        machines = CastingMachine.objects.filter(line=line, active=True).order_by('name')
        machine_list = [{'name': m.name, 'id': m.id} for m in machines]

        # データを取得
        plans = DailyMachineCastingProductionPlan.objects.filter(
            line=line,
            date__gte=start_date,
            date__lte=end_date
        ).select_related('machine', 'production_item').order_by('date', 'machine', 'production_item', 'shift')

        # ラインのデフォルト稼働率を取得（パーセント表示用に100倍）
        default_occupancy_rate = (line.occupancy_rate * 100) if line.occupancy_rate else ''

        # 休日出勤チェック用のデータを一括取得（ループ内でのクエリを削減）
        weekend_work_dates = set(
            DailyMachineCastingProductionPlan.objects.filter(
                line=line,
                date__gte=start_date,
                date__lte=end_date,
                shift='day'
            ).values_list('date', flat=True).distinct()
        )

        # 日付リストを生成
        dates = []
        for current_date in date_list:
            is_weekend = current_date.weekday() >= 5
            has_weekend_work = current_date in weekend_work_dates if is_weekend else False

            dates.append({
                'date': current_date,
                'day': current_date.day,
                'weekday': current_date.weekday(),
                'is_weekend': is_weekend,
                'occupancy_rate': default_occupancy_rate,
                'has_weekend_work': has_weekend_work
            })

        # 前月最終在庫を取得
        # 前月の最終日を計算（加工生産計画と同じ方法を使用）
        first_day_of_month = date(year, month, 1)
        last_day_of_previous_month = first_day_of_month - relativedelta(days=1)
        prev_month_last_date = last_day_of_previous_month

        # 前月最終日の夜勤の在庫数を品番ごとに取得（DailyCastingProductionPlanから）
        previous_month_inventory = {}
        prev_month_plans = DailyCastingProductionPlan.objects.filter(
            line=line,
            date=prev_month_last_date,
            shift='night'
        ).select_related('production_item')

        for plan in prev_month_plans:
            if plan.production_item and plan.stock:
                item_name = plan.production_item.name
                previous_month_inventory[item_name] = plan.stock

        # 前月の最後の5直分の生産計画を機械ごとに取得（連続生産チェック用）
        # 1直目の6直連続判定のために必要

        # 対象日付を計算
        # 前月最終日の日勤、夜勤
        # 前月最終日-1日の日勤、夜勤
        # 前月最終日-2日の夜勤
        check_dates = []
        for days_back in range(3):  # 0, 1, 2
            check_dates.append(prev_month_last_date - timedelta(days=days_back))

        # まとめて取得（1回のクエリで全データを取得）
        prev_month_plans_all = DailyMachineCastingProductionPlan.objects.filter(
            line=line,
            date__in=check_dates
        ).select_related('machine', 'production_item')

        # 辞書化: {(date, shift): [plans]}
        prev_plans_dict = {}
        for plan in prev_month_plans_all:
            key = (plan.date, plan.shift)
            if key not in prev_plans_dict:
                prev_plans_dict[key] = []
            prev_plans_dict[key].append(plan)

        # 必要な形式に整形
        previous_month_production_plans = []
        for days_back in range(3):  # 0, 1, 2
            check_date = prev_month_last_date - timedelta(days=days_back)

            for shift_name in ['day', 'night']:
                # 3日前（days_back=2）の日勤はスキップ（5直分のみ）
                if days_back == 2 and shift_name == 'day':
                    continue

                # 辞書から取得
                key = (check_date, shift_name)
                prev_plans = prev_plans_dict.get(key, [])

                shift_plans = {}
                for plan in prev_plans:
                    if plan.machine and plan.production_item:
                        machine_name = plan.machine.name
                        item_name = plan.production_item.name
                        shift_plans[machine_name] = item_name

                previous_month_production_plans.append({
                    'date': check_date.strftime('%Y-%m-%d'),
                    'shift': shift_name,
                    'plans': shift_plans
                })

        # 並び順を逆にする（古い順 -> 新しい順）
        previous_month_production_plans.reverse()

        # 在庫数・出庫数データを辞書形式で取得
        # DailyCastingProductionPlanから取得
        stock_plans = DailyCastingProductionPlan.objects.filter(
            line=line,
            date__gte=start_date,
            date__lte=end_date
        ).select_related('production_item')

        # 辞書形式でキャッシュ（キー：(品番名, 日付, シフト)）
        stock_plans_dict = {}
        for plan in stock_plans:
            if plan.production_item:
                key = (plan.production_item.name, plan.date, plan.shift)
                stock_plans_dict[key] = plan

        # 在庫数データを整形（品番 × シフト × 日付）
        inventory_data_day = []
        inventory_data_night = []

        for item_name in item_names:
            # 日勤
            day_row = {'item_name': item_name, 'cells': []}
            for date_info in dates:
                # 辞書から在庫数を取得
                key = (item_name, date_info['date'], 'day')
                plan = stock_plans_dict.get(key)
                stock = plan.stock if plan and plan.stock is not None else ''

                day_row['cells'].append({
                    'value': stock,
                    'is_weekend': date_info['is_weekend']
                })
            inventory_data_day.append(day_row)

            # 夜勤
            night_row = {'item_name': item_name, 'cells': []}
            for date_info in dates:
                # 辞書から在庫数を取得
                key = (item_name, date_info['date'], 'night')
                plan = stock_plans_dict.get(key)
                stock = plan.stock if plan and plan.stock is not None else ''

                night_row['cells'].append({
                    'value': stock,
                    'is_weekend': date_info['is_weekend']
                })
            inventory_data_night.append(night_row)

        # 鋳造品番と加工品番の紐づけを取得
        casting_to_machining_map = {}
        item_maps = MachiningItemCastingItemMap.objects.filter(
            casting_line_name=line.name,
            active=True
        )
        for item_map in item_maps:
            casting_key = item_map.casting_item_name
            if casting_key not in casting_to_machining_map:
                casting_to_machining_map[casting_key] = []
            casting_to_machining_map[casting_key].append({
                'machining_line_name': item_map.machining_line_name,
                'machining_item_name': item_map.machining_item_name
            })

        # 加工生産計画データを取得（出庫数のデフォルト値として使用）
        machining_plans = DailyMachiningProductionPlan.objects.filter(
            date__gte=start_date,
            date__lte=end_date
        ).select_related('production_item', 'line')

        # 加工生産計画を辞書化: {(machining_line_name, machining_item_name, date, shift): [plans]}
        # 同じキーで複数のプランが存在する可能性があるため、リストで保持
        machining_plans_dict = {}
        for plan in machining_plans:
            if plan.production_item and plan.line:
                key = (plan.line.name, plan.production_item.name, plan.date, plan.shift)
                if key not in machining_plans_dict:
                    machining_plans_dict[key] = []
                machining_plans_dict[key].append(plan)

        # 出庫数データを整形（品番 × シフト × 日付）
        # stock_plans_dictから取得（在庫数と同じデータソース）
        # データがない場合は、紐づいた加工生産計画のproduction_quantityを使用
        delivery_data_day = []
        delivery_data_night = []

        for item_name in item_names:
            # 日勤
            day_row = {'item_name': item_name, 'cells': []}
            for date_info in dates:
                # 辞書から出庫数を取得
                key = (item_name, date_info['date'], 'day')
                plan = stock_plans_dict.get(key)
                count = plan.holding_out_count if plan and plan.holding_out_count else None

                # 出庫数がない場合は、紐づいた加工生産計画から取得
                if count is None or count == 0:
                    # 紐づいた加工品番を取得
                    machining_items = casting_to_machining_map.get(item_name, [])
                    total_production = 0
                    for machining_item_info in machining_items:
                        machining_key = (
                            machining_item_info['machining_line_name'],
                            machining_item_info['machining_item_name'],
                            date_info['date'],
                            'day'
                        )
                        # リストで保持されているため、全プランを取得して合算
                        machining_plans_list = machining_plans_dict.get(machining_key, [])
                        for machining_plan in machining_plans_list:
                            if machining_plan.production_quantity:
                                total_production += machining_plan.production_quantity

                    if total_production > 0:
                        count = total_production

                day_row['cells'].append({
                    'value': count if count and count > 0 else '',
                    'is_weekend': date_info['is_weekend']
                })
            delivery_data_day.append(day_row)

            # 夜勤
            night_row = {'item_name': item_name, 'cells': []}
            for date_info in dates:
                # 辞書から出庫数を取得
                key = (item_name, date_info['date'], 'night')
                plan = stock_plans_dict.get(key)
                count = plan.holding_out_count if plan and plan.holding_out_count else None

                # 出庫数がない場合は、紐づいた加工生産計画から取得
                if count is None or count == 0:
                    # 紐づいた加工品番を取得
                    machining_items = casting_to_machining_map.get(item_name, [])
                    total_production = 0
                    for machining_item_info in machining_items:
                        machining_key = (
                            machining_item_info['machining_line_name'],
                            machining_item_info['machining_item_name'],
                            date_info['date'],
                            'night'
                        )
                        # リストで保持されているため、全プランを取得して合算
                        machining_plans_list = machining_plans_dict.get(machining_key, [])
                        for machining_plan in machining_plans_list:
                            if machining_plan.production_quantity:
                                total_production += machining_plan.production_quantity

                    if total_production > 0:
                        count = total_production

                night_row['cells'].append({
                    'value': count if count and count > 0 else '',
                    'is_weekend': date_info['is_weekend']
                })
            delivery_data_night.append(night_row)

        # 生産台数データを整形（品番 × シフト × 日付）
        # フロントエンドで計算されるため、初期表示は空白
        production_data_day = []
        production_data_night = []

        for item_name in item_names:
            day_row = {'item_name': item_name, 'cells': []}
            night_row = {'item_name': item_name, 'cells': []}
            for date_info in dates:
                day_row['cells'].append({'value': '', 'is_weekend': date_info['is_weekend']})
                night_row['cells'].append({'value': '', 'is_weekend': date_info['is_weekend']})
            production_data_day.append(day_row)
            production_data_night.append(night_row)

        # 生産計画データを辞書形式で取得（重複がある場合はIDが最大のものを使用）
        plans_dict = {}
        for plan in plans:
            if plan.machine:
                key = (plan.machine.id, plan.date, plan.shift)
                # 同じキーで既存のレコードがある場合、IDが大きい方を保持
                if key not in plans_dict or plan.id > plans_dict[key].id:
                    plans_dict[key] = plan

        # 計画停止データを整形（鋳造機 × シフト × 日付）
        stop_time_data_day = []
        stop_time_data_night = []

        for machine in machine_list:
            day_row = {'machine_name': machine['name'], 'cells': []}
            night_row = {'machine_name': machine['name'], 'cells': []}
            for date_info in dates:
                # 日勤の計画停止時間を辞書から取得
                day_key = (machine['id'], date_info['date'], 'day')
                day_plan = plans_dict.get(day_key)

                # データがない場合は0、週末の場合は空
                stop_time_value = ''
                if not date_info['is_weekend']:
                    stop_time_value = day_plan.stop_time if day_plan and day_plan.stop_time is not None else 0

                day_row['cells'].append({
                    'value': stop_time_value,
                    'is_weekend': date_info['is_weekend']
                })

                # 夜勤の計画停止時間を辞書から取得
                night_key = (machine['id'], date_info['date'], 'night')
                night_plan = plans_dict.get(night_key)

                # データがない場合は0、週末の場合は空
                stop_time_value_night = ''
                if not date_info['is_weekend']:
                    stop_time_value_night = night_plan.stop_time if night_plan and night_plan.stop_time is not None else 0

                night_row['cells'].append({
                    'value': stop_time_value_night,
                    'is_weekend': date_info['is_weekend']
                })
            stop_time_data_day.append(day_row)
            stop_time_data_night.append(night_row)

        # 残業計画データを整形（鋳造機 × シフト × 日付）
        overtime_data_day = []
        overtime_data_night = []

        for machine in machine_list:
            day_row = {'machine_name': machine['name'], 'cells': []}
            night_row = {'machine_name': machine['name'], 'cells': []}
            for date_info in dates:
                # 日勤の残業時間を辞書から取得
                day_key = (machine['id'], date_info['date'], 'day')
                day_plan = plans_dict.get(day_key)

                # データがない場合は0、週末の場合は空
                overtime_value = ''
                if not date_info['is_weekend']:
                    overtime_value = day_plan.overtime if day_plan and day_plan.overtime is not None else 0

                day_row['cells'].append({
                    'value': overtime_value,
                    'is_weekend': date_info['is_weekend']
                })

                # 夜勤の残業時間を辞書から取得
                night_key = (machine['id'], date_info['date'], 'night')
                night_plan = plans_dict.get(night_key)

                # データがない場合は0、週末の場合は空
                overtime_value_night = ''
                if not date_info['is_weekend']:
                    overtime_value_night = night_plan.overtime if night_plan and night_plan.overtime is not None else 0

                night_row['cells'].append({
                    'value': overtime_value_night,
                    'is_weekend': date_info['is_weekend']
                })
            overtime_data_day.append(day_row)
            overtime_data_night.append(night_row)

        # 金型交換データを整形（鋳造機 × シフト × 日付）
        mold_change_data_day = []
        mold_change_data_night = []

        for machine in machine_list:
            day_row = {'machine_name': machine['name'], 'cells': []}
            night_row = {'machine_name': machine['name'], 'cells': []}
            for date_info in dates:
                # 日勤の金型交換時間を辞書から取得
                day_key = (machine['id'], date_info['date'], 'day')
                day_plan = plans_dict.get(day_key)

                # データがない場合は0、週末の場合は空
                mold_change_value = ''
                if not date_info['is_weekend']:
                    mold_change_value = day_plan.mold_change if day_plan and day_plan.mold_change is not None else 0

                day_row['cells'].append({
                    'value': mold_change_value,
                    'is_weekend': date_info['is_weekend']
                })

                # 夜勤の金型交換時間を辞書から取得
                night_key = (machine['id'], date_info['date'], 'night')
                night_plan = plans_dict.get(night_key)

                # データがない場合は0、週末の場合は空
                mold_change_value_night = ''
                if not date_info['is_weekend']:
                    mold_change_value_night = night_plan.mold_change if night_plan and night_plan.mold_change is not None else 0

                night_row['cells'].append({
                    'value': mold_change_value_night,
                    'is_weekend': date_info['is_weekend']
                })
            mold_change_data_day.append(day_row)
            mold_change_data_night.append(night_row)

        # 生産計画データを整形（鋳造機 × シフト × 日付）
        # 各鋳造機に登録されている品番のリストを取得
        production_plan_data_day = []
        production_plan_data_night = []

        for machine in machine_list:
            # この鋳造機に登録されている品番を取得
            machine_items = CastingItemMachineMap.objects.filter(
                line=line,
                machine_id=machine['id'],
                active=True
            ).order_by('casting_item__name').values_list('casting_item__name', flat=True)

            machine_items_list = list(machine_items)

            day_row = {
                'machine_name': machine['name'],
                'machine_id': machine['id'],
                'items': machine_items_list,
                'cells': []
            }
            night_row = {
                'machine_name': machine['name'],
                'machine_id': machine['id'],
                'items': machine_items_list,
                'cells': []
            }

            for date_info in dates:
                # 日勤の生産計画品番を辞書から取得
                day_key = (machine['id'], date_info['date'], 'day')
                day_plan = plans_dict.get(day_key)

                day_row['cells'].append({
                    'items': machine_items_list,
                    'selected': day_plan.production_item.name if day_plan and day_plan.production_item else '',
                    'is_weekend': date_info['is_weekend']
                })

                # 夜勤の生産計画品番を辞書から取得
                night_key = (machine['id'], date_info['date'], 'night')
                night_plan = plans_dict.get(night_key)

                night_row['cells'].append({
                    'items': machine_items_list,
                    'selected': night_plan.production_item.name if night_plan and night_plan.production_item else '',
                    'is_weekend': date_info['is_weekend']
                })

            production_plan_data_day.append(day_row)
            production_plan_data_night.append(night_row)

        # 品番ごとのタクトと良品率を取得（計算用）
        # 品番に対して複数の鋳造機がある場合は、最初のマッピングのタクトと良品率を使用
        item_data = {}
        for item_name in item_names:
            # 品番名で最初に見つかったマッピングのタクトと良品率を使用
            item_map = CastingItemMachineMap.objects.filter(
                line=line,
                casting_item__name=item_name,
                active=True
            ).select_related('casting_item').first()
            if item_map:
                item_data[item_name] = {
                    'tact': item_map.tact if item_map.tact else 0,
                    'yield_rate': item_map.yield_rate if item_map.yield_rate else 0
                }
        lines = CastingLine.objects.filter(active=True).order_by('name')
        lines_list = [{'id': l.id, 'name': l.name} for l in lines]

        # 適正在庫と月末在庫を比較
        inventory_comparison = []
        for item_name in item_names:
            # 鋳造品番の適正在庫を取得
            casting_item = CastingItem.objects.filter(
                line=line,
                name=item_name,
                active=True
            ).first()

            optimal_inventory = casting_item.optimal_inventory if casting_item and casting_item.optimal_inventory is not None else 0

            # 月末在庫を取得（最終在庫入力フィールドの値、またはデータベースから）
            # 注: 鋳造では最終在庫入力があるため、その値を使用
            # ページ読み込み時点では0として、JavaScriptで更新
            end_of_month_inventory = 0

            # 差分を計算
            difference = end_of_month_inventory - optimal_inventory

            inventory_comparison.append({
                'name': item_name,
                'optimal_inventory': optimal_inventory,
                'end_of_month_inventory': end_of_month_inventory,
                'difference': difference
            })

        # セクションごとの行数を計算（日勤 + 夜勤）
        item_total_rows = len(item_names) * 2  # 品番ごとのセクション（出庫、生産台数、在庫）
        machine_total_rows = len(machine_list) * 2  # 鋳造機ごとのセクション（生産計画、残業時間、計画停止）

        context = {
            'year': year,
            'month': month,
            'line': line,
            'dates': dates,
            'item_names': item_names,
            'machines': machine_list,
            'inventory_data_day': inventory_data_day,
            'inventory_data_night': inventory_data_night,
            'delivery_data_day': delivery_data_day,
            'delivery_data_night': delivery_data_night,
            'production_data_day': production_data_day,
            'production_data_night': production_data_night,
            'stop_time_data_day': stop_time_data_day,
            'stop_time_data_night': stop_time_data_night,
            'overtime_data_day': overtime_data_day,
            'overtime_data_night': overtime_data_night,
            'mold_change_data_day': mold_change_data_day,
            'mold_change_data_night': mold_change_data_night,
            'production_plan_data_day': production_plan_data_day,
            'production_plan_data_night': production_plan_data_night,
            'item_data_json': json.dumps(item_data),
            'previous_month_inventory_json': json.dumps(previous_month_inventory),
            'previous_month_production_plans_json': json.dumps(previous_month_production_plans),
            'lines': lines_list,
            'inventory_comparison': inventory_comparison,
            'item_total_rows': item_total_rows,  # 品番ごとのセクションの総行数
            'machine_total_rows': machine_total_rows,  # 鋳造機ごとのセクションの総行数
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """生産計画データを保存"""
        try:
            # JSONデータを取得
            data = json.loads(request.body)
            plan_data = data.get('plan_data', [])
            weekends_to_delete = data.get('weekends_to_delete', [])

            # 対象期間を取得
            if request.GET.get('year') and request.GET.get('month'):
                year = int(request.GET.get('year'))
                month = int(request.GET.get('month'))
            else:
                year = datetime.now().year
                month = datetime.now().month

            start_date = datetime(year, month, 1).date()
            end_date = datetime(year, month, calendar.monthrange(year, month)[1]).date()

            # ラインを取得
            if request.GET.get('line'):
                line = CastingLine.objects.get(id=request.GET.get('line'))
            else:
                line = CastingLine.objects.get(name='ヘッド')

            # 鋳造機リストを取得
            machines = list(CastingMachine.objects.filter(line=line, active=True).order_by('name'))

            # 日付リストを生成
            dates = []
            current_date = start_date
            while current_date <= end_date:
                dates.append(current_date)
                current_date += timedelta(days=1)

            # データをグループ化（残業時間、計画停止、生産計画を同じレコードに保存）
            grouped_data = {}
            item_plan_data = {}  # 品番ごとの計画データ（在庫数・出庫数を統合）
            production_data = {}  # 生産台数データ（品番×シフト×日付）

            for item in plan_data:
                item_type = item.get('type')

                if item_type == 'inventory':
                    # 在庫数データを統合
                    date_index = item.get('date_index')
                    shift = item.get('shift')
                    item_name = item.get('item_name')
                    stock = item.get('stock')

                    key = f"{date_index}_{shift}_{item_name}"
                    if key not in item_plan_data:
                        item_plan_data[key] = {
                            'date_index': date_index,
                            'shift': shift,
                            'item_name': item_name,
                            'stock': None,
                            'delivery': None
                        }
                    item_plan_data[key]['stock'] = stock

                elif item_type == 'delivery':
                    # 出庫数データを統合
                    date_index = item.get('date_index')
                    shift = item.get('shift')
                    item_name = item.get('item_name')
                    delivery = item.get('delivery')

                    key = f"{date_index}_{shift}_{item_name}"
                    if key not in item_plan_data:
                        item_plan_data[key] = {
                            'date_index': date_index,
                            'shift': shift,
                            'item_name': item_name,
                            'stock': None,
                            'delivery': None
                        }
                    item_plan_data[key]['delivery'] = delivery
                elif item_type == 'production':
                    # 生産台数データは別に保存
                    date_index = item.get('date_index')
                    shift = item.get('shift')
                    item_name = item.get('item_name')
                    production_count = item.get('production_count')

                    prod_key = f"{date_index}_{shift}_{item_name}"
                    production_data[prod_key] = {
                        'date_index': date_index,
                        'shift': shift,
                        'item_name': item_name,
                        'production_count': production_count
                    }
                else:
                    # 計画停止、残業時間、生産計画
                    date_index = item.get('date_index')
                    shift = item.get('shift')
                    machine_index = item.get('machine_index')

                    # キーを作成
                    key = f"{date_index}_{shift}_{machine_index}"

                    if key not in grouped_data:
                        grouped_data[key] = {
                            'date_index': date_index,
                            'shift': shift,
                            'machine_index': machine_index,
                            'stop_time': None,
                            'overtime': None,
                            'mold_change': None,
                            'item_name': None
                        }

                    if item_type == 'stop_time':
                        grouped_data[key]['stop_time'] = item.get('stop_time')
                    elif item_type == 'overtime':
                        grouped_data[key]['overtime'] = item.get('overtime')
                    elif item_type == 'mold_change':
                        grouped_data[key]['mold_change'] = item.get('mold_change')
                    elif item_type == 'production_plan':
                        grouped_data[key]['item_name'] = item.get('item_name')

            # データベースに保存
            saved_count = 0
            for key, data in grouped_data.items():
                date_index = data['date_index']
                shift = data['shift']
                machine_index = data['machine_index']
                stop_time = data['stop_time']
                overtime = data['overtime']
                mold_change = data['mold_change']
                item_name = data['item_name']

                # 日付を取得
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # 鋳造機を取得
                if machine_index >= len(machines):
                    continue
                machine = machines[machine_index]

                # 品番を取得
                production_item = None
                if item_name:
                    # CastingItemMachineMapを通じて品番を取得
                    item_map = CastingItemMachineMap.objects.filter(
                        line=line,
                        machine=machine,
                        casting_item__name=item_name,
                        active=True
                    ).select_related('casting_item').first()
                    if item_map:
                        production_item = item_map.casting_item

                # production_itemを条件に含めてupdate_or_create
                if production_item:
                    # 同じ鋳造機・日付・シフトの他の品番のレコードをすべて削除
                    DailyMachineCastingProductionPlan.objects.filter(
                        line=line,
                        machine=machine,
                        date=date,
                        shift=shift
                    ).exclude(
                        production_item=production_item
                    ).delete()

                    # 選択された品番のレコードを作成または更新
                    DailyMachineCastingProductionPlan.objects.update_or_create(
                        line=line,
                        machine=machine,
                        date=date,
                        shift=shift,
                        production_item=production_item,
                        defaults={
                            'stop_time': stop_time if stop_time is not None else 0,
                            'overtime': overtime if overtime is not None else 0,
                            'mold_change': mold_change if mold_change is not None else 0,
                            'last_updated_user': request.user.username if request.user.is_authenticated else 'system'
                        }
                    )
                    saved_count += 1
                elif item_name == '' or item_name is None:
                    # 品番が空の場合、該当する設備・日付・シフトの全てのレコードを削除
                    deleted = DailyMachineCastingProductionPlan.objects.filter(
                        line=line,
                        machine=machine,
                        date=date,
                        shift=shift
                    ).delete()
                    if deleted[0] > 0:
                        saved_count += 1
                elif stop_time is not None or overtime is not None or mold_change is not None:
                    # production_itemがない場合でも、stop_time、overtime、mold_changeだけ更新（全レコードに適用）
                    update_fields = {}
                    if stop_time is not None:
                        update_fields['stop_time'] = stop_time
                    if overtime is not None:
                        update_fields['overtime'] = overtime
                    if mold_change is not None:
                        update_fields['mold_change'] = mold_change

                    if update_fields:
                        updated = DailyMachineCastingProductionPlan.objects.filter(
                            line=line,
                            machine=machine,
                            date=date,
                            shift=shift
                        ).update(**update_fields)
                        if updated > 0:
                            saved_count += updated

            # 在庫数・出庫数を保存（DailyCastingProductionPlanに統合して保存）
            for key, plan_item in item_plan_data.items():
                date_index = plan_item['date_index']
                shift = plan_item['shift']
                item_name = plan_item['item_name']
                stock = plan_item['stock']
                delivery = plan_item['delivery']

                # 日付を取得
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # 品番を取得
                production_item = CastingItem.objects.filter(
                    line=line,
                    name=item_name,
                    active=True
                ).first()

                if production_item:
                    # defaultsを構築（Noneでない値のみ設定）
                    defaults = {
                        'last_updated_user': request.user.username if request.user.is_authenticated else 'system'
                    }
                    if stock is not None:
                        defaults['stock'] = stock
                    if delivery is not None:
                        defaults['holding_out_count'] = delivery

                    # DailyCastingProductionPlanに在庫数・出庫数を保存
                    DailyCastingProductionPlan.objects.update_or_create(
                        line=line,
                        production_item=production_item,
                        date=date,
                        shift=shift,
                        defaults=defaults
                    )
                    saved_count += 1

            # 生産台数を保存
            for prod_key, prod_data in production_data.items():
                date_index = prod_data['date_index']
                shift = prod_data['shift']
                item_name = prod_data['item_name']
                production_count = prod_data['production_count']

                # 日付を取得
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # この品番を生産している最初の鋳造機のレコードに生産台数を保存
                production_item = CastingItem.objects.filter(
                    line=line,
                    name=item_name,
                    active=True
                ).first()

                if production_item:
                    # この品番を持つレコードを更新
                    updated = DailyMachineCastingProductionPlan.objects.filter(
                        line=line,
                        date=date,
                        shift=shift,
                        production_item=production_item
                    ).update(production_count=production_count)

                    if updated > 0:
                        saved_count += 1

            # 休日出勤が消された日付のDailyMachineCastingProductionPlanを削除
            deleted_count = 0
            for date_index in weekends_to_delete:
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # 該当日付のDailyMachineCastingProductionPlanを削除（日勤のみ、週末なので）
                deleted = DailyMachineCastingProductionPlan.objects.filter(
                    line=line,
                    date=date,
                    shift='day'
                ).delete()

                if deleted[0] > 0:
                    deleted_count += deleted[0]

            return JsonResponse({
                'status': 'success',
                'message': f'{saved_count}件のデータを保存し、{deleted_count}件のデータを削除しました'
            })

        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': str(e)
            }, status=400)


class AutoCastingProductionPlanView(ManagementRoomPermissionMixin, View):
    """自動生産計画生成"""

    def post(self, request, *args, **kwargs):
        try:
            # パラメータ取得
            data = json.loads(request.body)

            year = data.get('year')
            month = data.get('month')
            line_id = data.get('line_id')
            target_inventory = data.get('target_inventory', {})  # 月末目標在庫

            if not all([year, month, line_id]):
                return JsonResponse({
                    'status': 'error',
                    'message': '必要なパラメータが不足しています'
                }, status=400)

            line = CastingLine.objects.get(id=line_id)
            machines = list(CastingMachine.objects.filter(line=line, active=True).order_by('name'))

            # 対象期間を計算（days_in_month_dates関数を使用）
            date_list = days_in_month_dates(year, month)
            start_date = date_list[0]
            end_date = date_list[-1]

            # 平日のリストを作成
            weekdays = [d for d in date_list if d.weekday() < 5]  # 月曜〜金曜

            # 品番リストと出庫数を取得
            delivery_plans = DailyCastingProductionPlan.objects.filter(
                line=line,
                date__gte=start_date,
                date__lte=end_date
            ).select_related('production_item')

            # 品番ごとの月間出庫数を集計
            item_delivery = {}
            for plan in delivery_plans:
                if plan.production_item:
                    item_name = plan.production_item.name
                    if item_name not in item_delivery:
                        item_delivery[item_name] = []
                    item_delivery[item_name].append({
                        'date': plan.date,
                        'shift': plan.shift,
                        'count': plan.holding_out_count or 0
                    })

            # 前月最終在庫を取得（加工生産計画と同じ方法を使用）
            first_day_of_month = date(year, month, 1)
            prev_month_last_date = first_day_of_month - relativedelta(days=1)

            prev_inventory = {}
            prev_plans = DailyMachineCastingProductionPlan.objects.filter(
                line=line,
                date=prev_month_last_date,
                shift='night'
            ).select_related('production_item')

            for plan in prev_plans:
                if plan.production_item and plan.stock:
                    item_name = plan.production_item.name
                    if item_name in prev_inventory:
                        prev_inventory[item_name] = max(prev_inventory[item_name], plan.stock)
                    else:
                        prev_inventory[item_name] = plan.stock

            # 品番マスタデータを取得（品番×鋳造機のペア）
            item_data = {}
            item_maps = CastingItemMachineMap.objects.filter(
                line=line,
                active=True
            ).select_related('casting_item', 'machine')
            for item_map in item_maps:
                # 品番と鋳造機のペアをキーにする
                key = f"{item_map.casting_item.name}_{item_map.machine.id}"
                item_data[key] = {
                    'name': item_map.casting_item.name,
                    'tact': item_map.tact or 0,
                    'yield_rate': item_map.yield_rate or 0,
                    'machine': item_map.machine,
                    'machine_id': item_map.machine.id
                }

            # 自動生産計画を生成
            result = self._generate_auto_plan(
                weekdays=weekdays,
                machines=machines,
                item_delivery=item_delivery,
                prev_inventory=prev_inventory,
                target_inventory=target_inventory,
                item_data=item_data,
                line=line,
                occupancy_rate=line.occupancy_rate or 1.0
            )

            return JsonResponse({
                'status': 'success',
                'data': result
            })

        except Exception as e:
            import traceback
            return JsonResponse({
                'status': 'error',
                'message': str(e),
                'traceback': traceback.format_exc()
            }, status=400)

    def _generate_auto_plan(self, weekdays, machines, item_delivery, prev_inventory,
                           target_inventory, item_data, line, occupancy_rate):
        """自動生産計画を生成する"""

        # 日勤・夜勤の基本稼働時間
        BASE_TIME = {'day': 490, 'night': 485}
        MIN_STOCK = 50  # 最小在庫
        SHIFT_BLOCK = 6  # 6直で同じ品番を作る

        # 全シフトのリスト（日付×シフト）
        all_shifts = []
        for date in weekdays:
            all_shifts.append((date, 'day'))
            all_shifts.append((date, 'night'))

        # 各鋳造機の生産計画
        machine_plans = {m.id: [] for m in machines}

        # 各鋳造機の現在の品番（継続するため）
        machine_current_item = {}
        machine_item_shift_count = {}  # 各鋳造機が同じ品番を何直作っているか

        # 各品番の在庫シミュレーション（品番名でまとめる）
        all_item_names = set()
        for key, data in item_data.items():
            all_item_names.add(data['name'])
        inventory = {item: prev_inventory.get(item, 0) for item in all_item_names}

        # 各鋳造機の初期品番を決定
        # 各品番がどの鋳造機に割り当てられているかを追跡
        assigned_items = set()

        for machine in machines:
            machine_items = []
            for key, data in item_data.items():
                if data['machine_id'] == machine.id:
                    item_name = data['name']
                    if item_name not in machine_items:
                        machine_items.append(item_name)

            if machine_items:
                # 月間出庫数を計算
                item_demands = {}
                for item_name in machine_items:
                    total_demand = 0
                    if item_name in item_delivery:
                        for d in item_delivery[item_name]:
                            total_demand += d['count']
                    item_demands[item_name] = total_demand

                # 出庫数が多い順にソート
                sorted_items = sorted(item_demands.items(), key=lambda x: x[1], reverse=True)

                # まだ他の鋳造機に割り当てられていない品番を優先的に選択
                selected_item = None
                for item_name, demand in sorted_items:
                    if item_name not in assigned_items:
                        selected_item = item_name
                        assigned_items.add(item_name)
                        break

                # すべて割り当て済みの場合は、出庫数が最も多い品番を選択
                if not selected_item and sorted_items:
                    selected_item = sorted_items[0][0]
                    assigned_items.add(selected_item)

                if selected_item:
                    machine_current_item[machine.id] = selected_item
                    machine_item_shift_count[machine.id] = 0

        # シフトごとに処理
        for shift_idx, (date, shift) in enumerate(all_shifts):
            # この直で各品番の出庫数を取得
            delivery_this_shift = {}
            for item_name, deliveries in item_delivery.items():
                for d in deliveries:
                    if d['date'] == date and d['shift'] == shift:
                        delivery_this_shift[item_name] = d['count']

            # 在庫が50を下回りそうな品番を優先的に生産
            priority_items = []
            for item_name in item_data.keys():
                current_stock = inventory.get(item_name, 0)
                delivery = delivery_this_shift.get(item_name, 0)
                future_stock = current_stock - delivery

                if future_stock < MIN_STOCK:
                    shortage = MIN_STOCK - future_stock + delivery
                    priority_items.append((item_name, shortage, current_stock))

            # 不足量でソート
            priority_items.sort(key=lambda x: x[1], reverse=True)

            # 各鋳造機に品番を割り当て
            for machine in machines:
                # この鋳造機で作れる品番（品番名のリスト）
                machine_items = []
                machine_item_data = {}
                for key, data in item_data.items():
                    if data['machine_id'] == machine.id:
                        item_name = data['name']
                        if item_name not in machine_items:
                            machine_items.append(item_name)
                            machine_item_data[item_name] = data

                if not machine_items:
                    continue

                # 現在の品番と直数を確認
                current_item = machine_current_item.get(machine.id)
                shift_count = machine_item_shift_count.get(machine.id, 0)

                selected_item = None

                # 6直未満の場合は、現在の品番を継続
                if current_item and shift_count < SHIFT_BLOCK:
                    if current_item in machine_items:
                        selected_item = current_item
                        machine_item_shift_count[machine.id] = shift_count + 1
                else:
                    # 6直経過したか、初回の場合は品番を決定
                    # まず、在庫が不足している品番を優先
                    for item_name, shortage, current_stock in priority_items:
                        if item_name in machine_items:
                            selected_item = item_name
                            break

                    # 在庫が十分な場合は、前の品番を継続
                    if not selected_item and current_item and current_item in machine_items:
                        selected_item = current_item

                    # それでもない場合は、最初の品番
                    if not selected_item and machine_items:
                        selected_item = machine_items[0]

                    # 品番を更新
                    if selected_item:
                        machine_current_item[machine.id] = selected_item
                        machine_item_shift_count[machine.id] = 1

                if selected_item:
                    # 残業なしで計画
                    overtime = 0

                    machine_plans[machine.id].append({
                        'date': date,
                        'shift': shift,
                        'shift_idx': shift_idx,
                        'item_name': selected_item,
                        'overtime': overtime
                    })

            # この直の生産台数を計算して在庫を更新
            production_this_shift = {}
            for machine in machines:
                plan_list = [p for p in machine_plans[machine.id]
                           if p['date'] == date and p['shift'] == shift]

                if plan_list:
                    plan = plan_list[0]
                    item_name = plan['item_name']

                    # 品番と鋳造機のペアでデータを取得
                    key = f"{item_name}_{machine.id}"
                    data = item_data.get(key)

                    if not data:
                        continue

                    if data['tact'] > 0:
                        working_time = BASE_TIME[shift] + plan['overtime']
                        production = math.floor(
                            (working_time / data['tact']) * occupancy_rate * data['yield_rate']
                        )

                        if item_name in production_this_shift:
                            production_this_shift[item_name] += production
                        else:
                            production_this_shift[item_name] = production

            # 在庫を更新
            for item_name in inventory.keys():
                production = production_this_shift.get(item_name, 0)
                delivery = delivery_this_shift.get(item_name, 0)
                inventory[item_name] = inventory[item_name] + production - delivery

        # 結果をフォーマット
        result = []
        for machine in machines:
            for plan in machine_plans[machine.id]:
                result.append({
                    'machine_id': machine.id,
                    'machine_name': machine.name,
                    'date': plan['date'].isoformat(),
                    'shift': plan['shift'],
                    'item_name': plan['item_name'],
                    'overtime': plan['overtime']
                })

        return result
