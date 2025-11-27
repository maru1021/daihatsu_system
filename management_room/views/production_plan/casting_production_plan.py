from management_room.models import DailyMachineCastingProductionPlan, DailyCastingProductionPlan, CastingItem, CastingItemMachineMap, MachiningItemCastingItemMap, DailyMachiningProductionPlan, UsableMold, CastingItemProhibitedPattern
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
        item_names = list(CastingItem.objects.filter(line=line, active=True).values_list('name', flat=True).distinct())

        # 鋳造機を取得
        machine_list = list(CastingMachine.objects.filter(line=line, active=True).order_by('name').values('name', 'id'))

        # データを取得（当月の全データを1回のクエリで取得）
        plans = DailyMachineCastingProductionPlan.objects.filter(
            line=line,
            date__gte=start_date,
            date__lte=end_date
        ).select_related('machine', 'production_item').order_by('date', 'machine', 'production_item', 'shift')

        # ラインのデフォルト稼働率を取得（パーセント表示用に100倍）
        default_occupancy_rate = (line.occupancy_rate * 100) if line.occupancy_rate else ''

        # 休日出勤チェック用のデータを既存のplansから抽出（追加クエリ不要）
        weekend_work_dates = set(
            plan.date for plan in plans if plan.shift == 'day'
        )

        # 定時データを取得（日付ごと）
        regular_working_hours_dict = {}
        for plan in plans:
            if plan.date and plan.regular_working_hours:
                regular_working_hours_dict[plan.date] = True

        # 土日の出庫数データを取得（DailyCastingProductionPlanから）
        # 出庫数が0より大きい日付を抽出
        weekend_delivery_dates = set()
        weekend_stock_plans = DailyCastingProductionPlan.objects.filter(
            line=line,
            date__gte=start_date,
            date__lte=end_date,
            shift='day'
        ).select_related('production_item')

        for plan in weekend_stock_plans:
            if plan.date and plan.date.weekday() >= 5 and plan.holding_out_count and plan.holding_out_count > 0:
                weekend_delivery_dates.add(plan.date)

        # 日付リストを生成
        dates = []
        for current_date in date_list:
            is_weekend = current_date.weekday() >= 5
            has_weekend_work = current_date in weekend_work_dates if is_weekend else False
            is_regular_hours = regular_working_hours_dict.get(current_date, False)
            has_weekend_delivery = current_date in weekend_delivery_dates if is_weekend else False

            dates.append({
                'date': current_date,
                'weekday': current_date.weekday(),
                'is_weekend': is_weekend,
                'occupancy_rate': default_occupancy_rate,
                'has_weekend_work': has_weekend_work,
                'is_regular_hours': is_regular_hours,
                'has_weekend_delivery': has_weekend_delivery
            })

        # 前月データを取得（在庫と生産計画を効率的に取得）
        first_day_of_month = date(year, month, 1)
        prev_month_last_date = first_day_of_month - relativedelta(days=1)
        prev_month_first_date = date(prev_month_last_date.year, prev_month_last_date.month, 1)

        # 前月の使用可能金型数を取得
        prev_usable_molds = UsableMold.objects.filter(
            line=line,
            month=prev_month_first_date
        ).select_related('machine', 'item_name').order_by('machine', 'item_name')

        # 前月の対象日付を計算（最終日から2日前まで）
        check_dates = [prev_month_last_date - timedelta(days=i) for i in range(3)]

        # 前月の生産計画を1回のクエリで取得（連続生産チェック用）
        prev_month_plans_all = DailyMachineCastingProductionPlan.objects.filter(
            line=line,
            date__in=check_dates
        ).select_related('machine', 'production_item')

        # 前月最終日の夜勤の在庫数を品番ごとに取得（DailyCastingProductionPlanから）
        previous_month_inventory = {}
        prev_month_stock_plans = DailyCastingProductionPlan.objects.filter(
            line=line,
            date=prev_month_last_date,
            shift='night'
        ).select_related('production_item')

        for plan in prev_month_stock_plans:
            if plan.production_item and plan.stock:
                item_name = plan.production_item.name
                previous_month_inventory[item_name] = plan.stock

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

        # 生産計画データを辞書化（重複がある場合はIDが最大のものを使用）
        plans_dict = {}
        for plan in plans:
            if plan.machine:
                key = (plan.machine.id, plan.date, plan.shift)
                # 同じキーで既存のレコードがある場合、IDが大きい方を保持
                if key not in plans_dict or plan.id > plans_dict[key].id:
                    plans_dict[key] = plan

        # 前月末の金型を辞書化（設備IDをキーとする）
        prev_month_molds_by_machine = {}
        for mold in prev_usable_molds:
            # 1～5の金型のみ
            if mold.used_count > 0 and mold.used_count < 6 and mold.end_of_month:
                prev_month_molds_by_machine[mold.machine.id] = {
                    'item_name': mold.item_name.name,
                    'used_count': mold.used_count
                }

        # 日付ベースのデータ構造を構築
        dates_data = []

        for date_index, date_info in enumerate(dates):
            current_date = date_info['date']
            is_weekend = date_info['is_weekend']

            date_data = {
                'date': current_date,
                'weekday': date_info['weekday'],
                'is_weekend': is_weekend,
                'occupancy_rate': date_info['occupancy_rate'],
                'has_weekend_work': date_info['has_weekend_work'],
                'is_regular_hours': date_info.get('is_regular_hours', False),
                'has_weekend_delivery': date_info.get('has_weekend_delivery', False),
                'shifts': {
                    'day': {'items': {}, 'machines': {}},
                    'night': {'items': {}, 'machines': {}}
                }
            }

            # 日勤と夜勤を統一的に処理
            for shift in ['day', 'night']:
                # 品番データを処理
                for item_name in item_names:
                    plan = stock_plans_dict.get((item_name, current_date, shift))
                    delivery = plan.holding_out_count if plan and plan.holding_out_count else None

                    # 出庫数がない場合は加工生産計画から取得
                    if delivery is None or delivery == 0:
                        machining_items = casting_to_machining_map.get(item_name, [])
                        total_production = 0
                        for machining_item_info in machining_items:
                            machining_key = (
                                machining_item_info['machining_line_name'],
                                machining_item_info['machining_item_name'],
                                current_date,
                                shift
                            )
                            machining_plans_list = machining_plans_dict.get(machining_key, [])
                            for machining_plan in machining_plans_list:
                                if machining_plan.production_quantity:
                                    total_production += machining_plan.production_quantity
                        if total_production > 0:
                            delivery = total_production

                    date_data['shifts'][shift]['items'][item_name] = {
                        'inventory': plan.stock if plan and plan.stock is not None else '',
                        'delivery': delivery if delivery and delivery > 0 else '',
                        'production': ''  # フロントエンドで計算
                    }

                # 機械データを処理
                for machine in machine_list:
                    machine_id = machine['id']
                    machine_name = machine['name']

                    # 鋳造機の品番リストを取得
                    machine_items = list(CastingItemMachineMap.objects.filter(
                        line=line,
                        machine_id=machine_id,
                        active=True
                    ).order_by('casting_item__name').values_list('casting_item__name', flat=True))

                    plan = plans_dict.get((machine_id, current_date, shift))

                    # 【修正】最初の日付のday直の場合、前月末の金型をselected_itemとして設定
                    selected_item = ''
                    mold_count = 0
                    if date_index == 0 and shift == 'day' and machine_id in prev_month_molds_by_machine:
                        # 前月末の金型を設定（引き継ぎなので+1する）
                        prev_mold = prev_month_molds_by_machine[machine_id]
                        selected_item = prev_mold['item_name']
                        mold_count = prev_mold['used_count'] + 1
                    elif plan and plan.production_item:
                        # 既存の計画から取得
                        selected_item = plan.production_item.name
                        mold_count = plan.mold_count if plan.mold_count is not None else 0

                    date_data['shifts'][shift]['machines'][machine_name] = {
                        'machine_id': machine_id,
                        'items': machine_items,
                        'stop_time': plan.stop_time if plan and plan.stop_time is not None else (0 if not is_weekend else ''),
                        'overtime': plan.overtime if plan and plan.overtime is not None else (0 if not is_weekend else ''),
                        'mold_change': plan.mold_change if plan and plan.mold_change is not None else (0 if not is_weekend else ''),
                        'mold_count': mold_count,
                        'selected_item': selected_item
                    }

            dates_data.append(date_data)


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
        lines_list = list(CastingLine.objects.filter(active=True).order_by('name').values('id', 'name'))

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

        # ラインの段取時間を取得
        changeover_time = line.changeover_time if line.changeover_time is not None else 0

        # 前月の使用可能金型数をJSON形式に変換
        prev_usable_molds_data = []
        for mold in prev_usable_molds:
            prev_usable_molds_data.append({
                'machine_name': mold.machine.name,
                'item_name': mold.item_name.name,
                'used_count': mold.used_count,
                'end_of_month': mold.end_of_month
            })

        context = {
            'year': year,
            'month': month,
            'line': line,
            'dates_data': dates_data,  # 新しい日付ベースのデータ構造
            'item_names': item_names,
            'machines': machine_list,
            'item_data_json': json.dumps(item_data),
            'previous_month_inventory_json': json.dumps(previous_month_inventory),
            'previous_month_production_plans_json': json.dumps(previous_month_production_plans),
            'prev_usable_molds_json': json.dumps(prev_usable_molds_data),
            'lines': lines_list,
            'inventory_comparison': inventory_comparison,
            'item_total_rows': item_total_rows,  # 品番ごとのセクションの総行数
            'machine_total_rows': machine_total_rows,  # 鋳造機ごとのセクションの総行数
            'changeover_time': changeover_time,  # ラインの段取時間（分）
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """生産計画データを保存"""
        try:
            # JSONデータを取得
            data = json.loads(request.body)
            plan_data = data.get('plan_data', [])
            weekends_to_delete = data.get('weekends_to_delete', [])
            usable_molds_data = data.get('usable_molds_data', [])
            occupancy_rate_data = data.get('occupancy_rate_data', [])
            regular_working_hours_data = data.get('regular_working_hours_data', [])

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

            # 稼働率データを辞書化: {date_index: occupancy_rate}
            occupancy_rate_dict = {}
            for item in occupancy_rate_data:
                date_index = item.get('date_index')
                occupancy_rate = item.get('occupancy_rate')
                if date_index is not None and occupancy_rate is not None:
                    occupancy_rate_dict[date_index] = occupancy_rate

            # 定時データを辞書化: {date_index: True}
            regular_working_hours_dict = {}
            for item in regular_working_hours_data:
                date_index = item.get('date_index')
                regular_working_hours = item.get('regular_working_hours')
                if date_index is not None and regular_working_hours is not None:
                    regular_working_hours_dict[date_index] = regular_working_hours

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
                            'mold_count': None,
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
                        grouped_data[key]['mold_count'] = item.get('mold_count')

            # データベースに保存
            saved_count = 0
            for key, data in grouped_data.items():
                date_index = data['date_index']
                shift = data['shift']
                machine_index = data['machine_index']
                stop_time = data['stop_time']
                overtime = data['overtime']
                mold_change = data['mold_change']
                mold_count = data['mold_count']
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

                    # 稼働率と定時データを取得
                    occupancy_rate = occupancy_rate_dict.get(date_index)
                    regular_working_hours = regular_working_hours_dict.get(date_index, False)

                    # defaultsを構築
                    defaults = {
                        'stop_time': stop_time if stop_time is not None else 0,
                        'overtime': overtime if overtime is not None else 0,
                        'mold_change': mold_change if mold_change is not None else 0,
                        'mold_count': mold_count if mold_count is not None else 0,
                        'regular_working_hours': regular_working_hours,
                        'last_updated_user': request.user.username if request.user.is_authenticated else 'system'
                    }

                    # 稼働率がある場合のみ設定
                    if occupancy_rate is not None:
                        defaults['occupancy_rate'] = occupancy_rate

                    # 選択された品番のレコードを作成または更新
                    DailyMachineCastingProductionPlan.objects.update_or_create(
                        line=line,
                        machine=machine,
                        date=date,
                        shift=shift,
                        production_item=production_item,
                        defaults=defaults
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

            # 使用可能金型数を保存
            usable_molds_saved = 0
            if usable_molds_data:
                # 当月の既存データを削除
                UsableMold.objects.filter(
                    line=line,
                    month__year=year,
                    month__month=month
                ).delete()

                # 新しいデータを保存
                for mold_data in usable_molds_data:
                    machine_index = mold_data.get('machine_index')
                    item_name = mold_data.get('item_name')
                    used_count = mold_data.get('used_count')
                    end_of_month = mold_data.get('end_of_month')

                    if machine_index is not None and item_name:
                        machine = machines[machine_index]
                        item = CastingItem.objects.filter(name=item_name, line=line, active=True).first()

                        if machine and item:
                            UsableMold.objects.create(
                                month=start_date,
                                line=line,
                                machine=machine,
                                item_name=item,
                                used_count=used_count,
                                end_of_month=end_of_month,
                                last_updated_user=request.user.username
                            )
                            usable_molds_saved += 1

            return JsonResponse({
                'status': 'success',
                'message': f'{saved_count}件のデータを保存、{deleted_count}件のデータを削除、{usable_molds_saved}件の使用可能金型を保存しました'
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
            stop_time_data = data.get('stop_time_data', [])  # 計画停止データ
            weekend_work_dates = data.get('weekend_work_dates', [])  # 休出日リスト

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

            # 稼働日のリスト（平日 + 休出日）を作成
            weekend_work_date_objs = [datetime.strptime(d, '%Y-%m-%d').date() for d in weekend_work_dates]
            working_days = []
            for d in date_list:
                is_weekday = d.weekday() < 5  # 月曜〜金曜
                is_weekend_work = d in weekend_work_date_objs
                if is_weekday or is_weekend_work:
                    working_days.append(d)

            # 品番リストと出庫数を取得（DailyCastingProductionPlanから）
            delivery_plans = DailyCastingProductionPlan.objects.filter(
                line=line,
                date__gte=start_date,
                date__lte=end_date
            ).select_related('production_item')

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

            # 加工生産計画を辞書化
            machining_plans_dict = {}
            for plan in machining_plans:
                if plan.production_item and plan.line:
                    key = (plan.line.name, plan.production_item.name, plan.date, plan.shift)
                    if key not in machining_plans_dict:
                        machining_plans_dict[key] = []
                    machining_plans_dict[key].append(plan)

            # 品番ごとの出庫数を集計（日付・シフト別）
            item_delivery = {}

            # まずDailyCastingProductionPlanから取得
            delivery_dict = {}
            for plan in delivery_plans:
                if plan.production_item:
                    key = (plan.production_item.name, plan.date, plan.shift)
                    delivery_dict[key] = plan.holding_out_count or 0

            # 全品番、全日付、全シフトをループ
            casting_items = CastingItem.objects.filter(line=line, active=True)
            for item in casting_items:
                item_name = item.name
                item_delivery[item_name] = []

                for current_date in date_list:
                    for shift in ['day', 'night']:
                        # DailyCastingProductionPlanから出庫数を取得
                        delivery_key = (item_name, current_date, shift)
                        delivery = delivery_dict.get(delivery_key, 0)

                        # 出庫数がない場合は加工生産計画から取得
                        if delivery == 0:
                            machining_items = casting_to_machining_map.get(item_name, [])
                            total_production = 0
                            for machining_item_info in machining_items:
                                machining_key = (
                                    machining_item_info['machining_line_name'],
                                    machining_item_info['machining_item_name'],
                                    current_date,
                                    shift
                                )
                                machining_plans_list = machining_plans_dict.get(machining_key, [])
                                for machining_plan in machining_plans_list:
                                    if machining_plan.production_quantity:
                                        total_production += machining_plan.production_quantity
                            if total_production > 0:
                                delivery = total_production

                        if delivery > 0:
                            item_delivery[item_name].append({
                                'date': current_date,
                                'shift': shift,
                                'count': delivery
                            })

            # 前月最終在庫を取得（DailyCastingProductionPlanから）
            first_day_of_month = date(year, month, 1)
            prev_month_last_date = first_day_of_month - relativedelta(days=1)

            prev_inventory = {}
            prev_stock_plans = DailyCastingProductionPlan.objects.filter(
                line=line,
                date=prev_month_last_date,
                shift='night'
            ).select_related('production_item')

            for plan in prev_stock_plans:
                if plan.production_item and plan.stock is not None:
                    item_name = plan.production_item.name
                    prev_inventory[item_name] = plan.stock

            # 適正在庫を取得
            optimal_inventory = {}
            casting_items = CastingItem.objects.filter(line=line, active=True)
            for item in casting_items:
                optimal_inventory[item.name] = item.optimal_inventory or 0

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

            # 前月の使用可能金型数を取得
            prev_usable_molds = {}
            prev_month_first_date = date(prev_month_last_date.year, prev_month_last_date.month, 1)

            molds = UsableMold.objects.filter(
                line=line,
                month=prev_month_first_date,
                end_of_month=True  # 月末の金型状態のみ取得
            ).select_related('machine', 'item_name')

            for mold in molds:
                key = f"{mold.machine.id}_{mold.item_name.name}"
                prev_usable_molds[key] = {
                    'machine_id': mold.machine.id,
                    'item_name': mold.item_name.name,
                    'used_count': mold.used_count,
                    'end_of_month': mold.end_of_month
                }

            # 品番ペアごとの同時生産上限を取得
            prohibited_patterns = {}
            patterns = CastingItemProhibitedPattern.objects.filter(
                line=line,
                active=True
            ).select_related('item_name1', 'item_name2')

            for pattern in patterns:
                item1 = pattern.item_name1.name
                item2 = pattern.item_name2.name
                # 両方向のキーで登録（順序に依存しないように）
                prohibited_patterns[f"{item1}_{item2}"] = pattern.count or 2
                prohibited_patterns[f"{item2}_{item1}"] = pattern.count or 2

            # 自動生産計画を生成
            result = self._generate_auto_plan(
                working_days=working_days,
                machines=machines,
                item_delivery=item_delivery,
                prev_inventory=prev_inventory,
                optimal_inventory=optimal_inventory,
                item_data=item_data,
                stop_time_data=stop_time_data,
                prev_usable_molds=prev_usable_molds,
                prohibited_patterns=prohibited_patterns,
                line=line,
                occupancy_rate=line.occupancy_rate or 1.0
            )

            return JsonResponse({
                'status': 'success',
                'data': result.get('plans', []),
                'unused_molds': result.get('unused_molds', [])  # 使用されなかった金型データ
            })

        except Exception as e:
            import traceback
            return JsonResponse({
                'status': 'error',
                'message': str(e),
                'traceback': traceback.format_exc()
            }, status=400)

    def _generate_auto_plan(self, working_days, machines, item_delivery, prev_inventory,
                           optimal_inventory, item_data, stop_time_data, prev_usable_molds,
                           prohibited_patterns, line, occupancy_rate):
        """
        自動生産計画を生成する（在庫最適化 + 金型交換最小化）

        【新アルゴリズム】
        目標:
        1. 在庫を0以下にしない（絶対条件）
        2. 矢印を最小化（6直連続生産を優先）
        3. 全品番の残個数を均等化（月末予測在庫の偏りを最小化）
        4. 適正在庫周辺を保つ
        5. 残業時間を最小化
        """
        import os
        from datetime import datetime

        # 定数
        BASE_TIME = {'day': 490, 'night': 485}  # 基本稼働時間（分）
        OVERTIME_MAX = {'day': 120, 'night': 60}  # 残業上限（分）
        SAFETY_STOCK = 300  # 安全在庫（この値を下回らないようにする）
        MOLD_CHANGE_THRESHOLD = 6  # 金型交換閾値
        CHANGEOVER_TIME = line.changeover_time or 90  # 型替え時間（分）

        # ログファイルの設定
        log_dir = os.path.dirname(os.path.abspath(__file__))
        log_file_path = os.path.join(log_dir, 'inventory_simulation_log.txt')

        # 既存のログファイルを削除
        if os.path.exists(log_file_path):
            os.remove(log_file_path)

        # ログファイルを開く
        log_file = open(log_file_path, 'w', encoding='utf-8')
        log_file.write("=" * 80 + "\n")
        log_file.write("鋳造生産計画 在庫シミュレーションログ\n")
        log_file.write(f"生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        log_file.write("=" * 80 + "\n\n")

        # 全シフトのリスト（日付×シフト）
        # 土日（休出）は日勤のみ
        all_shifts = []
        for date in working_days:
            all_shifts.append((date, 'day'))
            # 土日（weekday: 5=土曜, 6=日曜）は夜勤なし
            if date.weekday() < 5:
                all_shifts.append((date, 'night'))

        # 計画停止データを辞書化: {(date, shift, machine_id): stop_time}
        stop_time_dict = {}
        for stop in stop_time_data:
            key = (stop['date'], stop['shift'], stop['machine_id'])
            stop_time_dict[key] = stop['stop_time']

        # 品番リストを作成
        all_item_names = set()
        for key, data in item_data.items():
            all_item_names.add(data['name'])

        # 在庫シミュレーション用の変数を初期化
        inventory = {item: prev_inventory.get(item, 0) for item in all_item_names}

        # 各鋳造機の生産計画
        machine_plans = {m.id: [] for m in machines}

        # 各鋳造機の現在の品番と連続直数
        machine_current_item = {}
        machine_shift_count = {}

        # 途中で取り外した金型の使用回数を記録（品番ごと）
        # {item_name: [used_count1, used_count2, ...]}
        # 金型は全設備で共有されるため、設備IDは含めない
        # 同一品番でも複数の使いかけ金型が存在する可能性があるためリスト形式
        # 6直目で外した金型は記録しない（メンテ済みで次は1から）
        detached_molds = {}

        # 金型使用管理（前月からの引き継ぎ）
        # 前月最終直に各設備についていた金型と使用回数を設定
        for key, mold in prev_usable_molds.items():
            # end_of_month=Trueのデータのみ取得しているので、used_count < 6 の条件のみチェック
            # 0は無効な値なので除外（1～5のみ引き継ぐ）
            if 0 < mold['used_count'] < MOLD_CHANGE_THRESHOLD:
                # 月末金型で1～5なら引き継ぎ
                machine_id = mold['machine_id']
                item_name = mold['item_name']

                # 初期品番として設定
                machine_current_item[machine_id] = item_name
                # 使用回数を引き継ぎ
                machine_shift_count[machine_id] = mold['used_count']

                # 注意: detached_moldsには記録しない
                # 設備に取り付けられた状態で開始するため、途中で外した金型ではない

        # ========================================
        # ヘルパー関数定義
        # ========================================

        def set_mold_count_for_item_change(machine_id, current_item, new_item, shift_count, detached_molds, detached_current_mold):
            """
            品番変更時の型数を設定する共通関数

            Args:
                machine_id: 設備ID
                current_item: 現在の品番
                new_item: 新しい品番
                shift_count: 現在の型数
                detached_molds: 使いかけ金型の辞書
                detached_current_mold: 現在の金型を記録済みかのフラグ

            Returns:
                (new_mold_count, updated_detached_current_mold): 新しい型数と更新されたフラグ
            """
            # 現在の品番の使いかけ金型を記録（1～5の場合、かつまだ記録していない場合）
            if not detached_current_mold and current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD:
                if current_item not in detached_molds:
                    detached_molds[current_item] = []
                detached_molds[current_item].append(shift_count)
                detached_current_mold = True

            # 新しい品番の使いかけ金型があれば引き継ぐ
            if new_item in detached_molds and len(detached_molds[new_item]) > 0:
                inherited_count = detached_molds[new_item].pop(0)
                new_mold_count = inherited_count + 1
                if len(detached_molds[new_item]) == 0:
                    del detached_molds[new_item]
            else:
                new_mold_count = 1

            return (new_mold_count, detached_current_mold)

        def set_mold_count_for_continue(machine_id, item_name, shift_count, detached_molds):
            """
            同じ品番を継続する場合の型数を設定する共通関数

            Args:
                machine_id: 設備ID
                item_name: 品番
                shift_count: 現在の型数
                detached_molds: 使いかけ金型の辞書

            Returns:
                new_mold_count: 新しい型数
            """
            # 型数=0（6直完了後）の場合、使いかけ金型を引き継ぐ
            if shift_count == 0 and item_name in detached_molds and len(detached_molds[item_name]) > 0:
                inherited_count = detached_molds[item_name].pop(0)
                new_mold_count = inherited_count + 1
                if len(detached_molds[item_name]) == 0:
                    del detached_molds[item_name]
            else:
                # 通常は前の直+1
                new_mold_count = shift_count + 1

            return new_mold_count

        def calculate_estimated_production(item_name, machine_id, shift, stop_time=0, overtime=0):
            """指定した品番・設備での推定生産数を計算"""
            key = f"{item_name}_{machine_id}"
            data = item_data.get(key)

            if not data or data['tact'] == 0:
                return 0

            working_time = BASE_TIME[shift] - stop_time + overtime
            if working_time < 0:
                working_time = 0

            # 生産数は不良品も含めた数量（不良率を掛けない）
            production = math.floor(
                (working_time / data['tact']) * occupancy_rate
            )
            return production

        def simulate_future_inventory_for_item(item_name, from_shift_idx, temp_machine_plans):
            """特定の品番の将来在庫をシミュレーション（マイナスになる直があるかチェック）"""
            # 現在の在庫から開始
            simulated_inv = inventory.get(item_name, 0)

            # from_shift_idxから月末までシミュレーション
            for idx in range(from_shift_idx, len(all_shifts)):
                sim_date, sim_shift = all_shifts[idx]

                # この直での出庫数
                delivery = 0
                for d in item_delivery.get(item_name, []):
                    if d['date'] == sim_date and d['shift'] == sim_shift:
                        delivery = d['count']
                        break

                # 出庫
                simulated_inv -= delivery

                # 生産数を計算（不良品も含む数量）して、在庫に加算する際は不良率を考慮（良品のみ）
                for machine in machines:
                    # この設備のこの直の計画を取得
                    plan_list = [p for p in temp_machine_plans[machine.id]
                                if p['date'] == sim_date and p['shift'] == sim_shift]

                    if plan_list and plan_list[0]['item_name'] == item_name:
                        plan = plan_list[0]
                        stop_time = plan.get('stop_time', 0)
                        overtime = plan.get('overtime', OVERTIME_MAX[sim_shift])
                        production = calculate_estimated_production(
                            item_name, machine.id, sim_shift, stop_time, overtime
                        )
                        # 在庫に加算する際は不良率を考慮（良品のみ）
                        key = f"{item_name}_{machine.id}"
                        yield_rate = item_data.get(key, {}).get('yield_rate', 1.0)
                        simulated_inv += math.floor(production * yield_rate)

                # マイナスになる直があればFalseを返す
                if simulated_inv < 0:
                    return False, simulated_inv, idx

            return True, simulated_inv, -1

        def calculate_end_of_month_inventory_all_items(temp_machine_plans):
            """全品番の月末予測在庫を計算"""
            eom_inventory = {}

            for item_name in all_item_names:
                simulated_inv = inventory.get(item_name, 0)

                # 月初から月末までシミュレーション
                for idx in range(len(all_shifts)):
                    sim_date, sim_shift = all_shifts[idx]

                    # この直での出庫数
                    delivery = 0
                    for d in item_delivery.get(item_name, []):
                        if d['date'] == sim_date and d['shift'] == sim_shift:
                            delivery = d['count']
                            break

                    # 出庫
                    simulated_inv -= delivery

                    # 生産数を計算（不良品も含む数量）して、在庫に加算する際は不良率を考慮（良品のみ）
                    for machine in machines:
                        plan_list = [p for p in temp_machine_plans[machine.id]
                                    if p['date'] == sim_date and p['shift'] == sim_shift]

                        if plan_list and plan_list[0]['item_name'] == item_name:
                            plan = plan_list[0]
                            stop_time = plan.get('stop_time', 0)
                            overtime = plan.get('overtime', OVERTIME_MAX[sim_shift])
                            production = calculate_estimated_production(
                                item_name, machine.id, sim_shift, stop_time, overtime
                            )
                            # 在庫に加算する際は不良率を考慮（良品のみ）
                            key = f"{item_name}_{machine.id}"
                            yield_rate = item_data.get(key, {}).get('yield_rate', 1.0)
                            simulated_inv += math.floor(production * yield_rate)

                eom_inventory[item_name] = simulated_inv

            return eom_inventory

        def can_assign_item(item_name, assigned_items_count, prohibited_patterns):
            """指定した品番を割り当てられるかチェック"""
            MAX_MACHINES_PER_ITEM = 2

            # 同一品番の上限チェック
            if assigned_items_count.get(item_name, 0) >= MAX_MACHINES_PER_ITEM:
                return False

            # 品番ペア制約チェック
            # この品番を追加した場合のカウント
            new_item_count = assigned_items_count.get(item_name, 0) + 1

            for other_item, other_count in assigned_items_count.items():
                if other_item == item_name or other_count == 0:
                    continue

                pair_key = f"{item_name}_{other_item}"
                pair_limit = prohibited_patterns.get(pair_key)

                if pair_limit is not None:
                    # この品番を追加した場合のペア数（2つの品番のうち小さい方）
                    pair_count = min(new_item_count, other_count)
                    if pair_count > pair_limit:
                        return False

            return True

        def find_most_urgent_item(machine_items, current_shift_idx, assigned_items_count, prohibited_patterns):
            """
            最も緊急度の高い品番（最初に在庫が切れる品番）を見つける

            Returns:
                最も緊急度の高い品番名、またはNone
            """
            urgent_items = []

            for item_name in machine_items:
                if not can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                    continue

                # この品番を生産しない場合の将来在庫をシミュレーション
                temp_plans = {m.id: list(machine_plans[m.id]) for m in machines}
                is_safe, end_inv, fail_idx = simulate_future_inventory_for_item(
                    item_name, current_shift_idx, temp_plans
                )

                if not is_safe:
                    # 将来在庫がマイナスになる = 緊急
                    # fail_idxが小さいほど早く在庫切れ = より緊急
                    current_stock = inventory.get(item_name, 0)
                    urgent_items.append((item_name, fail_idx, current_stock))

            if urgent_items:
                # 最も早く在庫切れする品番を選択（fail_idxが小さい順、同じなら現在在庫が少ない順）
                urgent_items.sort(key=lambda x: (x[1], x[2]))
                return urgent_items[0][0]

            return None

        # ========================================
        # 【新アルゴリズム】型替えイベント駆動アプローチ
        # ========================================

        # 各設備の次の型替えタイミング（直インデックス）を管理
        # 前月から継続する場合: 残り直数を計算
        # 未設定の場合: 0（最初の直から開始）
        next_changeover_timing = {}

        for machine in machines:
            current_item = machine_current_item.get(machine.id)
            shift_count = machine_shift_count.get(machine.id, 0)

            if current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD:
                # 前月から継続: 残り直数を計算（例: shift_count=4 なら、あと2直で型替え）
                remaining_shifts = MOLD_CHANGE_THRESHOLD - shift_count
                next_changeover_timing[machine.id] = remaining_shifts
            else:
                # 未設定または型替えタイミング: 最初の直から開始
                next_changeover_timing[machine.id] = 0

        # 処理済みの直インデックス（在庫シミュレーション用）
        processed_shift_idx = 0

        # ログ: 初期状態
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【初期状態】\n")
        log_file.write("=" * 80 + "\n\n")
        log_file.write("--- 各設備の初期状態と次の型替えタイミング ---\n")
        for machine in machines:
            current_item = machine_current_item.get(machine.id)
            shift_count = machine_shift_count.get(machine.id, 0)
            timing = next_changeover_timing.get(machine.id, 0)
            if current_item:
                log_file.write(f"  設備#{machine.name}: {current_item} (型数={shift_count}), 次の型替え: {timing}直後\n")
            else:
                log_file.write(f"  設備#{machine.name}: (未設定), 次の型替え: {timing}直後\n")
        log_file.write("\n")

        # 前月から継続する設備の計画を立てる
        log_file.write("--- 前月から継続する設備の計画 ---\n")
        for machine in machines:
            current_item = machine_current_item.get(machine.id)
            shift_count = machine_shift_count.get(machine.id, 0)
            timing = next_changeover_timing.get(machine.id, 0)

            if current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD and timing > 0:
                # 前月から継続: 最初の直から型替えタイミングまでの計画を立てる
                log_file.write(f"  設備#{machine.name}: {current_item} を型数={shift_count+1}から{shift_count+timing}まで生産\n")

                for i in range(timing):
                    shift_idx = i
                    if shift_idx >= len(all_shifts):
                        break

                    plan_date, plan_shift = all_shifts[shift_idx]

                    # 計画停止時間を取得
                    stop_time = stop_time_dict.get((plan_date, plan_shift, machine.id), 0)
                    overtime = OVERTIME_MAX[plan_shift]

                    # 型替え時間は不要（継続生産）
                    changeover_time = 0

                    current_mold_count = shift_count + i + 1

                    # 最後の直（6直目）の場合、型替え時間を設定
                    if current_mold_count >= MOLD_CHANGE_THRESHOLD:
                        changeover_time = CHANGEOVER_TIME

                    machine_plans[machine.id].append({
                        'date': plan_date,
                        'shift': plan_shift,
                        'item_name': current_item,
                        'overtime': overtime,
                        'stop_time': stop_time,
                        'changeover_time': changeover_time,
                        'mold_count': current_mold_count
                    })

                # 状態を更新
                machine_shift_count[machine.id] = shift_count + timing

                # 6直完了後は型数=0に設定
                if machine_shift_count[machine.id] >= MOLD_CHANGE_THRESHOLD:
                    machine_shift_count[machine.id] = 0
                    # 使いかけ金型を記録しない（6直完了したため）

        if not any(current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD and timing > 0
                   for machine in machines
                   for current_item, shift_count, timing in [(machine_current_item.get(machine.id),
                                                               machine_shift_count.get(machine.id, 0),
                                                               next_changeover_timing.get(machine.id, 0))]):
            log_file.write("  (前月から継続する設備なし)\n")
        log_file.write("\n")

        # 型替えイベント駆動メインループ
        iteration_count = 0
        MAX_ITERATIONS = len(all_shifts) * len(machines) * 2  # 無限ループ防止

        while processed_shift_idx < len(all_shifts) and iteration_count < MAX_ITERATIONS:
            iteration_count += 1

            # 最も早い型替えタイミングを見つける
            next_machine_id = None
            next_timing = float('inf')

            for machine in machines:
                timing = next_changeover_timing.get(machine.id, float('inf'))
                if timing < next_timing:
                    next_timing = timing
                    next_machine_id = machine.id

            # 全設備の型替えタイミングが計画期間外なら終了
            if next_timing >= len(all_shifts):
                break

            # 型替えタイミングまでの出荷・生産処理を実行
            for shift_idx in range(processed_shift_idx, next_timing):
                date, shift = all_shifts[shift_idx]

                # ログ: シフトのヘッダー
                log_file.write("\n" + "=" * 80 + "\n")
                log_file.write(f"【{date} {shift}直】（在庫・出荷処理のみ）\n")
                log_file.write("=" * 80 + "\n\n")

                # 出荷処理
                log_file.write("--- 出荷処理 ---\n")
                for item_name in sorted(all_item_names):
                    delivery = 0
                    for d in item_delivery.get(item_name, []):
                        if d['date'] == date and d['shift'] == shift:
                            delivery = d['count']
                            break

                    if delivery > 0:
                        before_stock = inventory.get(item_name, 0)
                        after_stock = before_stock - delivery
                        inventory[item_name] = after_stock
                        log_file.write(f"  {item_name}: {before_stock} → {after_stock} (出荷: {delivery}台)\n")
                log_file.write("\n")

                # 生産処理（既に決定済みの計画を実行）
                production_this_shift = {}
                for machine in machines:
                    plan_list = [p for p in machine_plans[machine.id]
                               if p['date'] == date and p['shift'] == shift]

                    if plan_list:
                        plan = plan_list[0]
                        item_name = plan['item_name']

                        key = f"{item_name}_{machine.id}"
                        data = item_data.get(key)

                        if data and data['tact'] > 0:
                            # 生産数を計算
                            changeover_time = plan.get('changeover_time', 0)
                            working_time = BASE_TIME[shift] - plan.get('stop_time', 0) - changeover_time + plan.get('overtime', 0)
                            if working_time < 0:
                                working_time = 0

                            production = math.floor((working_time / data['tact']) * occupancy_rate)
                            production_this_shift[item_name] = production_this_shift.get(item_name, 0) + production

                # 在庫を更新
                log_file.write("--- 生産処理 ---\n")
                for item_name in all_item_names:
                    production = production_this_shift.get(item_name, 0)
                    if production > 0:
                        # 良品率を考慮
                        yield_rate = 1.0
                        for key, data in item_data.items():
                            if data['name'] == item_name:
                                yield_rate = data['yield_rate']
                                break

                        good_production = math.floor(production * yield_rate)
                        before_stock = inventory.get(item_name, 0)
                        after_stock = before_stock + good_production
                        inventory[item_name] = after_stock
                        log_file.write(f"  {item_name}: {before_stock} → {after_stock} (生産: {good_production}台)\n")
                log_file.write("\n")

            processed_shift_idx = next_timing

            # 型替えタイミングに到達: 品番を決定して6直分の計画を立てる
            if next_timing < len(all_shifts):
                machine = next((m for m in machines if m.id == next_machine_id), None)
                if not machine:
                    break

                date, shift = all_shifts[next_timing]

                # ログ: 型替えイベント
                log_file.write("\n" + "=" * 80 + "\n")
                log_file.write(f"【{date} {shift}直】（設備#{machine.name} の型替えタイミング）\n")
                log_file.write("=" * 80 + "\n\n")

                # この設備で生産可能な品番リストを取得
                machine_items = []
                for key, data in item_data.items():
                    if data['machine_id'] == machine.id:
                        item_name = data['name']
                        if item_name not in machine_items:
                            machine_items.append(item_name)

                if not machine_items:
                    # 生産可能な品番がない場合は次の設備へ
                    next_changeover_timing[machine.id] = len(all_shifts)
                    continue

                # 現在このシフトで既に割り当てられた品番を確認
                assigned_items_count = {}
                for m in machines:
                    if m.id == machine.id:
                        continue  # 自分自身は除外
                    plan_list = [p for p in machine_plans[m.id]
                               if p['date'] == date and p['shift'] == shift]
                    if plan_list:
                        item = plan_list[0]['item_name']
                        assigned_items_count[item] = assigned_items_count.get(item, 0) + 1

                # 最も緊急度の高い品番を選択
                urgent_item = find_most_urgent_item(
                    machine_items, next_timing, assigned_items_count, prohibited_patterns
                )

                if not urgent_item:
                    # フォールバック: 最初に作れる品番を選択
                    for item_name in machine_items:
                        if can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                            urgent_item = item_name
                            break

                if not urgent_item and machine_items:
                    # それでもない場合は、制約を無視して最初の品番
                    urgent_item = machine_items[0]

                if urgent_item:
                    # 現在の品番と連続直数を確認
                    current_item = machine_current_item.get(machine.id)
                    shift_count = machine_shift_count.get(machine.id, 0)

                    # 型数を設定
                    if current_item != urgent_item:
                        # 品番が変わる場合
                        detached_current_mold = False
                        mold_count, _ = set_mold_count_for_item_change(
                            machine.id, current_item, urgent_item, shift_count, detached_molds, detached_current_mold
                        )
                    else:
                        # 同じ品番を継続（6完了後の再開始）
                        mold_count = 1

                    log_file.write(f"--- 設備#{machine.name} に {urgent_item} を割り当て（型数={mold_count}） ---\n\n")

                    # 6直分の計画を立てる（ただし、計画期間内のみ）
                    max_shifts = min(MOLD_CHANGE_THRESHOLD, len(all_shifts) - next_timing)

                    for i in range(max_shifts):
                        shift_idx = next_timing + i
                        if shift_idx >= len(all_shifts):
                            break

                        plan_date, plan_shift = all_shifts[shift_idx]

                        # 計画停止時間を取得
                        stop_time = stop_time_dict.get((plan_date, plan_shift, machine.id), 0)
                        overtime = OVERTIME_MAX[plan_shift]

                        # 型替え時間を判定
                        changeover_time = 0
                        if i == 0 and current_item and current_item != urgent_item:
                            # 品番変更による型替え
                            changeover_time = CHANGEOVER_TIME

                        current_mold_count = mold_count + i

                        # 6直目の場合、型替え時間を設定
                        if current_mold_count >= MOLD_CHANGE_THRESHOLD:
                            changeover_time = CHANGEOVER_TIME

                        machine_plans[machine.id].append({
                            'date': plan_date,
                            'shift': plan_shift,
                            'item_name': urgent_item,
                            'overtime': overtime,
                            'stop_time': stop_time,
                            'changeover_time': changeover_time,
                            'mold_count': current_mold_count
                        })

                    # 状態を更新
                    machine_current_item[machine.id] = urgent_item
                    machine_shift_count[machine.id] = mold_count + max_shifts - 1

                    # 6直完了後は型数=0に設定
                    if machine_shift_count[machine.id] >= MOLD_CHANGE_THRESHOLD:
                        machine_shift_count[machine.id] = 0

                    # 次の型替えタイミングを更新
                    next_changeover_timing[machine.id] = next_timing + max_shifts
                else:
                    # 品番を決定できなかった場合
                    next_changeover_timing[machine.id] = len(all_shifts)

        # 残りの直の在庫・出荷処理
        for shift_idx in range(processed_shift_idx, len(all_shifts)):
            date, shift = all_shifts[shift_idx]

            # ログ: シフトのヘッダー
            log_file.write("\n" + "=" * 80 + "\n")
            log_file.write(f"【{date} {shift}直】（残りの在庫・出荷処理）\n")
            log_file.write("=" * 80 + "\n\n")

            # 出荷処理
            log_file.write("--- 出荷処理 ---\n")
            for item_name in sorted(all_item_names):
                delivery = 0
                for d in item_delivery.get(item_name, []):
                    if d['date'] == date and d['shift'] == shift:
                        delivery = d['count']
                        break

                if delivery > 0:
                    before_stock = inventory.get(item_name, 0)
                    after_stock = before_stock - delivery
                    inventory[item_name] = after_stock
                    log_file.write(f"  {item_name}: {before_stock} → {after_stock} (出荷: {delivery}台)\n")
            log_file.write("\n")

            # 生産処理
            production_this_shift = {}
            for machine in machines:
                plan_list = [p for p in machine_plans[machine.id]
                           if p['date'] == date and p['shift'] == shift]

                if plan_list:
                    plan = plan_list[0]
                    item_name = plan['item_name']

                    key = f"{item_name}_{machine.id}"
                    data = item_data.get(key)

                    if data and data['tact'] > 0:
                        changeover_time = plan.get('changeover_time', 0)
                        working_time = BASE_TIME[shift] - plan.get('stop_time', 0) - changeover_time + plan.get('overtime', 0)
                        if working_time < 0:
                            working_time = 0

                        production = math.floor((working_time / data['tact']) * occupancy_rate)
                        production_this_shift[item_name] = production_this_shift.get(item_name, 0) + production

            # 在庫を更新
            log_file.write("--- 生産処理 ---\n")
            for item_name in all_item_names:
                production = production_this_shift.get(item_name, 0)
                if production > 0:
                    yield_rate = 1.0
                    for key, data in item_data.items():
                        if data['name'] == item_name:
                            yield_rate = data['yield_rate']
                            break

                    good_production = math.floor(production * yield_rate)
                    before_stock = inventory.get(item_name, 0)
                    after_stock = before_stock + good_production
                    inventory[item_name] = after_stock
                    log_file.write(f"  {item_name}: {before_stock} → {after_stock} (生産: {good_production}台)\n")
            log_file.write("\n")

            # ログ: 直後の在庫
            log_file.write("--- 直後の在庫 ---\n")
            for item_name in sorted(all_item_names):
                log_file.write(f"  {item_name}: {inventory.get(item_name, 0)} 台\n")
            log_file.write("\n")

            # ログ: 使いかけ金型の状態
            log_file.write("--- 使いかけ金型の状態 ---\n")
            if detached_molds:
                for item_name, mold_counts in detached_molds.items():
                    log_file.write(f"  {item_name}: {mold_counts}\n")
            else:
                log_file.write("  (なし)\n")
            log_file.write("\n")

        # ====================================================
        # 夜勤の残業チェック: 次の日勤と品番が異なる場合は残業禁止
        # ====================================================
        for i, (date, shift) in enumerate(all_shifts):
            if shift == 'night':
                # 次の直（日勤）があるかチェック
                if i + 1 < len(all_shifts):
                    next_date, next_shift = all_shifts[i + 1]

                    # 次の直が日勤であることを確認（夜勤の次は通常日勤）
                    if next_shift != 'day':
                        continue

                    # 各設備について夜勤と次の日勤の品番を比較
                    for machine in machines:
                        night_plans = [p for p in machine_plans[machine.id]
                                     if p['date'] == date and p['shift'] == 'night']
                        day_plans = [p for p in machine_plans[machine.id]
                                   if p['date'] == next_date and p['shift'] == next_shift]

                        if night_plans and day_plans:
                            night_item = night_plans[0]['item_name']
                            day_item = day_plans[0]['item_name']
                            night_changeover = night_plans[0].get('changeover_time', 0)
                            night_mold_count = night_plans[0].get('mold_count', 0)

                            # 品番が異なる場合は夜勤で型替え
                            if night_item != day_item:
                                # 夜勤で既に型替え時間が設定されている場合（6直目）は追加不要
                                if night_changeover == 0:
                                    # 型替え時間を設定（夜勤で型替えが発生）
                                    night_plans[0]['changeover_time'] = CHANGEOVER_TIME

                                # 夜勤で型替えするため、残業禁止
                                night_plans[0]['overtime'] = 0

                                # 次の日勤の型替え時間はクリア（夜勤で型替え済み）
                                if day_plans[0].get('changeover_time', 0) > 0:
                                    day_plans[0]['changeover_time'] = 0


            for i, (date, shift) in enumerate(all_shifts):
                if shift != 'day':
                    continue  # 日勤のみ処理

                # 同じ日の夜勤を取得
                night_shift_idx = i + 1
                if night_shift_idx >= len(all_shifts):
                    continue

                next_date, next_shift = all_shifts[night_shift_idx]

                # 次の直が夜勤で、同じ日付であることを確認
                if next_shift != 'night' or next_date != date:
                    continue

                # 各設備について日勤と夜勤の品番を比較
                for machine in machines:
                    day_plans = [p for p in machine_plans[machine.id]
                               if p['date'] == date and p['shift'] == 'day']
                    night_plans = [p for p in machine_plans[machine.id]
                                 if p['date'] == next_date and p['shift'] == next_shift]

                    if day_plans and night_plans:
                        day_item = day_plans[0]['item_name']
                        night_item = night_plans[0]['item_name']
                        day_changeover = day_plans[0].get('changeover_time', 0)

                        # 品番が異なる場合は日勤で型替え
                        if (day_item != night_item) and (day_changeover == 0):
                            # 日勤で既に型替え時間が設定されている場合（6直目）は追加不要
                            if day_changeover == 0:
                                # 型替え時間を設定（日勤で型替えが発生）
                                day_plans[0]['changeover_time'] = CHANGEOVER_TIME

        # ====================================================
        # 第2段階: 残業時間の最適化（過剰在庫を防ぐ）
        # ====================================================
        self._optimize_overtime(
            machine_plans, machines, all_item_names, item_data,
            prev_inventory, item_delivery, optimal_inventory,
            occupancy_rate, BASE_TIME, working_days
        )

        # 結果をフォーマット
        result = []

        # デバッグ: 10/6 day直のmold_countを確認
        for machine in machines:
            oct6_day_plans = [p for p in machine_plans[machine.id]
                            if p['date'].isoformat() == '2025-10-06' and p['shift'] == 'day']
            if oct6_day_plans:
                plan = oct6_day_plans[0]

        for machine in machines:
            for plan in machine_plans[machine.id]:
                mold_count = plan.get('mold_count', 0)
                changeover_time = plan.get('changeover_time', 0)
                result.append({
                    'machine_id': machine.id,
                    'machine_name': machine.name,
                    'date': plan['date'].isoformat(),
                    'shift': plan['shift'],
                    'item_name': plan['item_name'],
                    'overtime': plan['overtime'],
                    'mold_count': mold_count,  # 使用回数を追加
                    'changeover_time': changeover_time  # 型替え時間を追加
                })

        # ログファイルを閉じる
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("計画完了\n")
        log_file.write("=" * 80 + "\n")
        log_file.close()

        # 使用されなかった金型データを変換（翌月引き継ぎ用）
        unused_molds_data = []
        for item_name, used_counts in detached_molds.items():
            # 各金型（同一品番でも複数ある可能性）について
            for used_count in used_counts:
                # 品番に対応する全設備を取得
                item_machines = []
                for machine in machines:
                    # この品番がこの設備で作れるかチェック
                    key = f"{item_name}_{machine.id}"
                    if key in item_data:
                        item_machines.append(machine)

                # 最初の設備を代表として記録（実際には全設備で共有）
                if item_machines:
                    unused_molds_data.append({
                        'machine_id': item_machines[0].id,
                        'machine_name': item_machines[0].name,
                        'item_name': item_name,
                        'used_count': used_count,
                        'end_of_month': False  # 月末に設置されていない（途中で外された）
                    })

        return {
            'plans': result,
            'unused_molds': unused_molds_data
        }

    def _optimize_overtime(self, machine_plans, machines, all_item_names, item_data,
                          prev_inventory, item_delivery, optimal_inventory,
                          occupancy_rate, BASE_TIME, working_days):
        """
        残業時間の最適化（2段階アプローチ）

        手順:
        1. 上限残業で在庫シミュレーション
        2. 過剰在庫になる直の残業を削減
        3. 在庫不足になる直の残業を確保
        """

        # 全シフトのリスト
        all_shifts = []
        for date in working_days:
            all_shifts.append((date, 'day'))
            all_shifts.append((date, 'night'))

        # 各直での出庫数を辞書化
        delivery_dict = {}
        for item_name, deliveries in item_delivery.items():
            for d in deliveries:
                key = (d['date'], d['shift'], item_name)
                delivery_dict[key] = d['count']

        # 在庫シミュレーション
        inventory = {item: prev_inventory.get(item, 0) for item in all_item_names}

        for date, shift in all_shifts:
            # この直の生産数を計算
            production_this_shift = {}

            for machine in machines:
                plan_list = [p for p in machine_plans[machine.id]
                           if p['date'] == date and p['shift'] == shift]

                if plan_list:
                    plan = plan_list[0]
                    item_name = plan['item_name']

                    key = f"{item_name}_{machine.id}"
                    data = item_data.get(key)

                    if not data or data['tact'] == 0:
                        continue

                    # 生産台数を計算（現在の残業時間で、型替え時間を考慮）
                    # 不良品も含む数量
                    changeover_time = plan.get('changeover_time', 0)
                    working_time = BASE_TIME[shift] - plan['stop_time'] - changeover_time + plan['overtime']

                    if working_time < 0:
                        working_time = 0

                    production = math.floor(
                        (working_time / data['tact']) * occupancy_rate
                    )

                    if item_name in production_this_shift:
                        production_this_shift[item_name] += production
                    else:
                        production_this_shift[item_name] = production

            # 在庫を更新（良品のみを在庫に加算）
            for item_name in all_item_names:
                production = production_this_shift.get(item_name, 0)
                delivery_key = (date, shift, item_name)
                delivery = delivery_dict.get(delivery_key, 0)

                # 良品のみを在庫に加算（不良率を考慮）
                yield_rate = 1.0
                for key, data in item_data.items():
                    if data['name'] == item_name:
                        yield_rate = data['yield_rate']
                        break

                good_production = math.floor(production * yield_rate)

                current_stock = inventory[item_name]
                future_stock = current_stock + good_production - delivery
                target_stock = optimal_inventory.get(item_name, 0)

                # 過剰在庫の場合: この品番を作っている設備の残業を削減
                if future_stock > target_stock * 2.0:  # 適正在庫の2倍以上なら過剰（緩和）
                    excess = future_stock - target_stock

                    # この直でこの品番を生産している設備を探す
                    for machine in machines:
                        plan_list = [p for p in machine_plans[machine.id]
                                   if p['date'] == date and p['shift'] == shift and p['item_name'] == item_name]

                        if plan_list:
                            plan = plan_list[0]

                            # 夜勤で残業が0に設定されている場合はスキップ（次の日勤と品番が異なる）
                            if shift == 'night' and plan.get('overtime', 0) == 0:
                                continue

                            # 品番データを取得
                            key = f"{item_name}_{machine.id}"
                            data = item_data.get(key)

                            if not data or data['tact'] == 0:
                                continue

                            # 削減可能な残業時間を計算
                            # 過剰分を減らすために必要な残業削減量
                            reducible_production = min(excess, production_this_shift.get(item_name, 0))
                            reducible_time = (reducible_production * data['tact']) / (occupancy_rate * data['yield_rate'])

                            # 残業を削減（0以上を維持）
                            new_overtime = max(0, plan['overtime'] - reducible_time)
                            plan['overtime'] = int(round(new_overtime / 5) * 5)  # 5分単位

                # 在庫が0未満になる場合: 残業は削減しない（すでに上限）
                elif future_stock < 0:
                    # 警告: 残業上限でも在庫不足
                    pass

                # 在庫を更新
                inventory[item_name] = future_stock
