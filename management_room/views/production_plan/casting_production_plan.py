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

        # 最初の稼働日のインデックスを見つける（平日または休出日）
        first_working_date_index = -1
        for idx, date_info in enumerate(dates):
            is_weekend = date_info['is_weekend']
            has_weekend_work = date_info['has_weekend_work']
            if not is_weekend or has_weekend_work:
                first_working_date_index = idx
                break

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

                    # 【修正】最初の稼働日のday直の場合、前月末の金型をselected_itemとして設定
                    selected_item = ''
                    mold_count = 0
                    is_prev_month_mold = False
                    prev_month_item_name = ''
                    prev_month_mold_count = 0

                    if date_index == first_working_date_index and shift == 'day' and machine_id in prev_month_molds_by_machine:
                        # 前月末の金型を設定（引き継ぎなので+1する）
                        prev_mold = prev_month_molds_by_machine[machine_id]
                        selected_item = prev_mold['item_name']
                        mold_count = prev_mold['used_count'] + 1
                        is_prev_month_mold = True
                        prev_month_item_name = prev_mold['item_name']
                        prev_month_mold_count = mold_count
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
                        'selected_item': selected_item,
                        'is_prev_month_mold': is_prev_month_mold,
                        'prev_month_item_name': prev_month_item_name,
                        'prev_month_mold_count': prev_month_mold_count
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


