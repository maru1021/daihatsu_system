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
        item_names = list(CastingItem.objects.filter(line=line, active=True).values_list('name', flat=True).distinct().order_by('name'))

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

        # 日付リストを生成
        dates = []
        for current_date in date_list:
            is_weekend = current_date.weekday() >= 5
            has_weekend_work = current_date in weekend_work_dates if is_weekend else False

            dates.append({
                'date': current_date,
                'weekday': current_date.weekday(),
                'is_weekend': is_weekend,
                'occupancy_rate': default_occupancy_rate,
                'has_weekend_work': has_weekend_work
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

        # 日付ベースのデータ構造を構築
        dates_data = []

        for date_info in dates:
            current_date = date_info['date']
            is_weekend = date_info['is_weekend']

            date_data = {
                'date': current_date,
                'weekday': date_info['weekday'],
                'is_weekend': is_weekend,
                'occupancy_rate': date_info['occupancy_rate'],
                'has_weekend_work': date_info['has_weekend_work'],
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
                    date_data['shifts'][shift]['machines'][machine_name] = {
                        'machine_id': machine_id,
                        'items': machine_items,
                        'stop_time': plan.stop_time if plan and plan.stop_time is not None else (0 if not is_weekend else ''),
                        'overtime': plan.overtime if plan and plan.overtime is not None else (0 if not is_weekend else ''),
                        'mold_change': plan.mold_change if plan and plan.mold_change is not None else (0 if not is_weekend else ''),
                        'mold_count': plan.mold_count if plan and plan.mold_count is not None else 0,
                        'selected_item': plan.production_item.name if plan and plan.production_item else ''
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
            print(data)
            plan_data = data.get('plan_data', [])
            weekends_to_delete = data.get('weekends_to_delete', [])
            usable_molds_data = data.get('usable_molds_data', [])

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
                            'mold_count': mold_count if mold_count is not None else 0,
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
                month=prev_month_first_date
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
                'data': result
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
        自動生産計画を生成する（在庫最適化 + 残業最小化）

        目標:
        1. 在庫を0以下にしない
        2. 適正在庫周辺を保つ
        3. 残業時間を最小化
        """
        import os
        from datetime import datetime

        # 定数
        BASE_TIME = {'day': 490, 'night': 485}  # 基本稼働時間（分）
        OVERTIME_MAX = {'day': 120, 'night': 60}  # 残業上限（分）
        SAFETY_STOCK = 50  # 安全在庫（この値を下回らないようにする）
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

        # デバッグ: 稼働日とシフトを確認
        print(f"DEBUG: Total shifts = {len(all_shifts)}, working_days = {len(working_days)}")
        if len(all_shifts) >= 4:
            print(f"DEBUG: First 2 days: {all_shifts[:4]}")

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
            if mold['end_of_month'] and mold['used_count'] < MOLD_CHANGE_THRESHOLD:
                # 月末金型で6未満なら引き継ぎ
                machine_id = mold['machine_id']
                item_name = mold['item_name']

                # 初期品番として設定
                machine_current_item[machine_id] = item_name
                # 使用回数を引き継ぎ
                machine_shift_count[machine_id] = mold['used_count']

                # 6未満で引き継いだ場合は、detached_moldsにも記録（リスト形式）
                # （最初の直で別品番を選んだ時用）
                if item_name not in detached_molds:
                    detached_molds[item_name] = []
                detached_molds[item_name].append(mold['used_count'])

        # シフトごとに処理
        for shift_idx, (date, shift) in enumerate(all_shifts):
            # ログ: シフトのヘッダー
            log_file.write("\n" + "=" * 80 + "\n")
            log_file.write(f"【{date} {shift}直】\n")
            log_file.write("=" * 80 + "\n\n")

            # この直での各品番の出庫数を取得
            delivery_this_shift = {}
            for item_name, deliveries in item_delivery.items():
                for d in deliveries:
                    if d['date'] == date and d['shift'] == shift:
                        delivery_this_shift[item_name] = d['count']
                        break

            # ログ: 出荷処理
            log_file.write("--- 出荷処理 ---\n")
            for item_name in sorted(all_item_names):
                delivery = delivery_this_shift.get(item_name, 0)
                if delivery > 0:
                    before_stock = inventory.get(item_name, 0)
                    after_stock = before_stock - delivery
                    log_file.write(f"  {item_name}: {before_stock} → {after_stock} (出荷: {delivery}台)\n")
            log_file.write("\n")

            # 在庫不足リスクを計算（優先度付け）
            at_risk_items = []
            for item_name in all_item_names:
                current_stock = inventory.get(item_name, 0)
                delivery = delivery_this_shift.get(item_name, 0)
                future_stock = current_stock - delivery

                # 在庫が0未満または安全在庫を下回る場合は優先
                # 緊急度: 0未満 > 安全在庫未満
                if future_stock < 0:
                    # 在庫マイナスは最優先（不足量を大きく見積もる）
                    shortage = abs(future_stock) + 1000  # 優先度を高くするため+1000
                    at_risk_items.append((item_name, shortage, current_stock))
                elif future_stock < SAFETY_STOCK:
                    # 安全在庫を下回る場合
                    shortage = SAFETY_STOCK - future_stock + delivery
                    at_risk_items.append((item_name, shortage, current_stock))

            # 不足量でソート（緊急度が高い順）
            at_risk_items.sort(key=lambda x: x[1], reverse=True)

            # デバッグ: 在庫不足品番をログ出力
            if at_risk_items and (date, shift) == all_shifts[0]:  # 最初の直のみ
                print(f"\n=== {date} {shift} 在庫不足リスク ===")
                for item_name, shortage, stock in at_risk_items[:5]:
                    print(f"  {item_name}: 在庫={stock}, 不足={shortage}")

            # 適正在庫から離れている品番を抽出（不足率で評価）
            optimal_priority_items = []
            for item_name in all_item_names:
                current_stock = inventory.get(item_name, 0)
                target_stock = optimal_inventory.get(item_name, 0)
                delivery = delivery_this_shift.get(item_name, 0)

                # 出荷後の在庫を予測
                future_stock = current_stock - delivery

                # 適正在庫より少ない場合のみ生産対象とする
                if future_stock < target_stock:
                    # 不足率を計算（%）
                    if target_stock > 0:
                        shortage_ratio = (target_stock - future_stock) / target_stock
                    else:
                        shortage_ratio = 0

                    # (品番, 不足率, 現在在庫) のタプル
                    optimal_priority_items.append((item_name, shortage_ratio, current_stock))

            # 不足率が高い順にソート
            optimal_priority_items.sort(key=lambda x: x[1], reverse=True)

            # この直で既に割り当てられた品番の数を追跡（同じ品番は2設備まで）
            assigned_items_count = {}  # {item_name: count}
            MAX_MACHINES_PER_ITEM = 2  # 同じ品番を同時に生産できる設備数の上限（絶対条件）

            # 品番ペア制約をチェックする関数
            def can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                """指定した品番を割り当てられるかチェック"""
                # 同一品番の上限チェック
                if assigned_items_count.get(item_name, 0) >= MAX_MACHINES_PER_ITEM:
                    return False

                # 品番ペア制約チェック
                for other_item, other_count in assigned_items_count.items():
                    if other_item == item_name or other_count == 0:
                        continue

                    # この品番ペアの上限を取得
                    pair_key = f"{item_name}_{other_item}"
                    pair_limit = prohibited_patterns.get(pair_key)

                    if pair_limit is not None:
                        # このペアで既に何設備使っているか
                        current_pair_count = min(
                            assigned_items_count.get(item_name, 0),
                            other_count
                        )
                        # 新規追加すると上限を超えるか
                        if current_pair_count + 1 > pair_limit:
                            return False

                return True

            # 各鋳造機に品番を割り当て
            for machine in machines:
                # この鋳造機で生産可能な品番リストを取得
                machine_items = []
                for key, data in item_data.items():
                    if data['machine_id'] == machine.id:
                        item_name = data['name']
                        if item_name not in machine_items:
                            machine_items.append(item_name)

                if not machine_items:
                    continue

                # 現在の品番と連続直数を確認
                current_item = machine_current_item.get(machine.id)
                shift_count = machine_shift_count.get(machine.id, 0)

                selected_item = None

                # 優先度1: 在庫マイナスまたは安全在庫割れ（緊急）- 即座に切り替え
                for item_name, shortage, stock in at_risk_items:
                    if item_name in machine_items:
                        future_stock = stock - delivery_this_shift.get(item_name, 0)
                        # 在庫が0未満または安全在庫を下回る場合
                        if future_stock < 0 or future_stock < SAFETY_STOCK:
                            if can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                                selected_item = item_name

                                # 品番が変わる場合のみ、型替え処理
                                if current_item != item_name:
                                    # 現在の金型が6未満なら記録（リストに追加）
                                    if current_item and shift_count < MOLD_CHANGE_THRESHOLD:
                                        if current_item not in detached_molds:
                                            detached_molds[current_item] = []
                                        detached_molds[current_item].append(shift_count)
                                        print(f"  -> 緊急切替: {current_item} ({shift_count}直目で外す)")

                                    # 緊急生産する品番の使いかけ金型があれば引き継ぐ（リストから取り出し）
                                    if item_name in detached_molds and len(detached_molds[item_name]) > 0:
                                        inherited_count = detached_molds[item_name].pop(0)  # 最も古いものを使用
                                        machine_shift_count[machine.id] = inherited_count + 1
                                        # リストが空になったら削除
                                        if len(detached_molds[item_name]) == 0:
                                            del detached_molds[item_name]
                                        print(f"  -> 緊急(金型再取付): {item_name} ({inherited_count}直目から{inherited_count + 1}直目へ)")
                                    else:
                                        machine_shift_count[machine.id] = 1
                                        if future_stock < 0:
                                            print(f"  -> 緊急(新規): {item_name} 在庫マイナス予測 (現在={stock}, 出荷後={future_stock})")
                                        else:
                                            print(f"  -> 緊急(新規): {item_name} 安全在庫割れ (現在={stock}, 出荷後={future_stock})")
                                else:
                                    # 同じ品番が連続する場合は前の直+1
                                    machine_shift_count[machine.id] = shift_count + 1
                                    print(f"  -> 緊急(継続): {item_name} ({shift_count + 1}直目)")
                                break

                # 優先度2: 6直未満で現在品番を継続（基本戦略: 6直連続）
                if not selected_item and current_item and shift_count < MOLD_CHANGE_THRESHOLD:
                    if current_item in machine_items:
                        if can_assign_item(current_item, assigned_items_count, prohibited_patterns):
                            # デバッグ: 土日の遷移を確認
                            if date.weekday() >= 5 or (shift_idx > 0 and all_shifts[shift_idx-1][0].weekday() >= 5):
                                print(f"DEBUG 優先度2: {date} {shift} machine={machine.name}, current_item={current_item}, shift_count={shift_count}, next={shift_count + 1}")
                            # 2段階在庫制限チェック
                            current_stock = inventory.get(current_item, 0)
                            target_stock = optimal_inventory.get(current_item, 0)

                            # 全品番が適正在庫に達しているか確認
                            all_items_at_target = True
                            min_shortage_ratio = 0
                            for item_name in all_item_names:
                                item_stock = inventory.get(item_name, 0)
                                item_target = optimal_inventory.get(item_name, 0)
                                if item_stock < item_target:
                                    all_items_at_target = False
                                    # 不足率を計算
                                    if item_target > 0:
                                        shortage_ratio = (item_target - item_stock) / item_target
                                        if shortage_ratio > min_shortage_ratio:
                                            min_shortage_ratio = shortage_ratio

                            should_continue = False

                            if all_items_at_target:
                                # フェーズ2: 全品番が適正在庫に達している → 適正在庫+200まで許容
                                if current_stock < target_stock + 200:
                                    should_continue = True
                                    # print(f"  -> 継続: {current_item} ({shift_count + 1}直目, フェーズ2)")
                            else:
                                # フェーズ1: まだ適正在庫未達の品番がある
                                # 現在品番が適正在庫を大きく超え、かつ他品番が大きく不足している場合のみ切り替え
                                # 条件1: 現在品番が適正在庫+100以上
                                # 条件2: 他の品番が50%以上不足
                                if current_stock > target_stock + 100 and min_shortage_ratio > 0.5:
                                    # 現在品番が十分あり、他品番が大きく不足している場合は切り替え
                                    if current_item not in detached_molds:
                                        detached_molds[current_item] = []
                                    detached_molds[current_item].append(shift_count)
                                    print(f"  -> 継続中止: {current_item} (6未満で外す: {shift_count}直目, フェーズ1) 現在品番十分 & 他品番大不足 (在庫={current_stock}, 適正={target_stock}, 最大不足率={min_shortage_ratio:.2%})")
                                else:
                                    # 基本的に6直連続を維持
                                    should_continue = True
                                    # print(f"  -> 継続: {current_item} ({shift_count + 1}直目, フェーズ1)")

                            if should_continue:
                                selected_item = current_item
                                machine_shift_count[machine.id] = shift_count + 1

                # 優先度3: 適正在庫に近づける（不足率が高い順、ただし既に割り当て済みの品番は調整）
                if not selected_item:
                    # この直で既に割り当てられている品番の生産増加量を計算
                    estimated_production_this_shift = {}
                    for m in machines:
                        if machine_plans[m.id] and machine_plans[m.id][-1]['date'] == date and machine_plans[m.id][-1]['shift'] == shift:
                            # 既にこの直で計画済みの設備
                            assigned_item = machine_plans[m.id][-1]['item_name']
                            if assigned_item:
                                # 簡易的な生産数推定（1設備あたり約200台と仮定）
                                estimated_production_this_shift[assigned_item] = estimated_production_this_shift.get(assigned_item, 0) + 200

                    # 不足率を再計算（既に割り当て済みの品番は生産増加を考慮）
                    adjusted_priority_items = []
                    for item_name, shortage_ratio, current_stock in optimal_priority_items:
                        # この直での生産増加分を考慮
                        estimated_increase = estimated_production_this_shift.get(item_name, 0)
                        adjusted_stock = current_stock + estimated_increase
                        target_stock = optimal_inventory.get(item_name, 0)

                        # 調整後の不足率を計算
                        if target_stock > 0:
                            adjusted_shortage_ratio = (target_stock - adjusted_stock) / target_stock
                        else:
                            adjusted_shortage_ratio = 0

                        # 不足している場合のみリストに追加
                        if adjusted_shortage_ratio > 0:
                            adjusted_priority_items.append((item_name, adjusted_shortage_ratio, current_stock))

                    # 調整後の不足率でソート
                    adjusted_priority_items.sort(key=lambda x: x[1], reverse=True)

                    # 最も不足している品番を選択
                    for item_name, adj_shortage_ratio, current_stock in adjusted_priority_items:
                        if item_name in machine_items:
                            if can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                                selected_item = item_name

                                # 品番が変わる場合のみ、使いかけの金型引き継ぎをチェック
                                if current_item != item_name:
                                    # 以前に外した金型があれば、その使用回数を引き継ぐ（リストから取り出し）
                                    if item_name in detached_molds and len(detached_molds[item_name]) > 0:
                                        inherited_count = detached_molds[item_name].pop(0)  # 最も古いものを使用
                                        machine_shift_count[machine.id] = inherited_count + 1
                                        # リストが空になったら削除
                                        if len(detached_molds[item_name]) == 0:
                                            del detached_molds[item_name]
                                        print(f"  -> 金型再取付: {item_name} ({inherited_count}直目から{inherited_count + 1}直目へ, 調整後不足率={adj_shortage_ratio:.2%})")
                                    else:
                                        machine_shift_count[machine.id] = 1
                                        print(f"  -> 新規開始: {item_name} (調整後不足率={adj_shortage_ratio:.2%}, 在庫={current_stock})")
                                else:
                                    # 同じ品番が連続する場合は前の直+1
                                    machine_shift_count[machine.id] = shift_count + 1
                                    print(f"  -> 継続: {item_name} ({shift_count + 1}直目, 調整後不足率={adj_shortage_ratio:.2%})")
                                break

                # 優先度4: 現在品番を継続（6直以上でもフォールバック）
                if not selected_item and current_item and current_item in machine_items:
                    if can_assign_item(current_item, assigned_items_count, prohibited_patterns):
                        selected_item = current_item
                        machine_shift_count[machine.id] = shift_count + 1
                        print(f"  -> フォールバック継続: {current_item} ({shift_count + 1}直目)")

                # 優先度5: 全品番から最も生産されていない品番を選択（ローテーション保証）
                if not selected_item:
                    # 全品番の累積生産回数を取得（この直までの累積）
                    item_production_count = {}
                    for m in machines:
                        for p in machine_plans[m.id]:
                            pname = p['item_name']
                            item_production_count[pname] = item_production_count.get(pname, 0) + 1

                    # この設備で作れる品番のうち、最も生産回数が少ない品番を選択
                    min_count = float('inf')
                    candidate_item = None
                    for item_name in machine_items:
                        if can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                            count = item_production_count.get(item_name, 0)
                            if count < min_count:
                                min_count = count
                                candidate_item = item_name

                    if candidate_item:
                        selected_item = candidate_item

                        # 品番が変わる場合のみ、使いかけの金型引き継ぎをチェック
                        if current_item != candidate_item:
                            if candidate_item in detached_molds and len(detached_molds[candidate_item]) > 0:
                                inherited_count = detached_molds[candidate_item].pop(0)  # 最も古いものを使用
                                machine_shift_count[machine.id] = inherited_count + 1
                                # リストが空になったら削除
                                if len(detached_molds[candidate_item]) == 0:
                                    del detached_molds[candidate_item]
                                print(f"  -> ローテーション(金型再取付): {candidate_item} ({inherited_count}直目から{inherited_count + 1}直目へ)")
                            else:
                                machine_shift_count[machine.id] = 1
                                print(f"  -> ローテーション(新規): {candidate_item}")
                        else:
                            # 同じ品番が連続する場合は前の直+1
                            machine_shift_count[machine.id] = shift_count + 1
                            print(f"  -> ローテーション(継続): {candidate_item} ({shift_count + 1}直目)")

                # 優先度6: デフォルト（最初の品番、2設備チェックと品番ペアチェック）
                if not selected_item and machine_items:
                    for item_name in machine_items:
                        if can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                            selected_item = item_name

                            # 品番が変わる場合のみ、使いかけの金型引き継ぎをチェック
                            if current_item != item_name:
                                if item_name in detached_molds and len(detached_molds[item_name]) > 0:
                                    inherited_count = detached_molds[item_name].pop(0)  # 最も古いものを使用
                                    machine_shift_count[machine.id] = inherited_count + 1
                                    # リストが空になったら削除
                                    if len(detached_molds[item_name]) == 0:
                                        del detached_molds[item_name]
                                    print(f"  -> デフォルト(金型再取付): {item_name} ({inherited_count}直目から{inherited_count + 1}直目へ)")
                                else:
                                    machine_shift_count[machine.id] = 1
                                    print(f"  -> デフォルト(新規): {item_name}")
                            else:
                                # 同じ品番が連続する場合は前の直+1
                                machine_shift_count[machine.id] = shift_count + 1
                                print(f"  -> デフォルト(継続): {item_name} ({shift_count + 1}直目)")
                            break

                # 品番を更新
                if selected_item:

                    # 型替え時間を判定
                    changeover_time = 0

                    # 6直目の型替え判定（品番変更による型替えは後で処理）
                    if current_item and current_item == selected_item and shift_count >= MOLD_CHANGE_THRESHOLD:
                        # 6直目では必ず金型交換（劣化による交換）
                        print(f"DEBUG: 6直目型替え {date} {shift}, machine={machine.name}, current={selected_item}, shift_count={shift_count}")

                        # 6直目で外した金型はメンテされるため記録しない
                        print(f"  -> 6直目: {selected_item} の金型を外して同じ品番の新金型に交換（劣化・メンテ）")

                        # 同じ品番でも金型は新品なので1からスタート
                        machine_shift_count[machine.id] = 1

                        changeover_time = CHANGEOVER_TIME

                    # 使用回数を取得（machine_shift_countは既に各優先度で更新済み）
                    current_mold_count = machine_shift_count.get(machine.id, 1)

                    # 7以上の値を1-6の範囲に補正（振り分けアルゴリズムは変更せず、表示のみ修正）
                    if current_mold_count > MOLD_CHANGE_THRESHOLD:
                        original_count = current_mold_count
                        current_mold_count = ((current_mold_count - 1) % MOLD_CHANGE_THRESHOLD) + 1
                        print(f"  -> 型数補正: {original_count}→{current_mold_count}")

                    machine_current_item[machine.id] = selected_item
                    # カウントを更新
                    assigned_items_count[selected_item] = assigned_items_count.get(selected_item, 0) + 1

                    # 計画停止時間を取得
                    stop_time = stop_time_dict.get((date, shift, machine.id), 0)

                    # 残業時間は後でまとめて最適化するため、仮で上限を設定
                    overtime = OVERTIME_MAX[shift]

                    machine_plans[machine.id].append({
                        'date': date,
                        'shift': shift,
                        'item_name': selected_item,
                        'overtime': overtime,
                        'stop_time': stop_time,
                        'changeover_time': changeover_time,
                        'mold_count': current_mold_count  # 使用回数を追加
                    })

            # この直の生産数を計算して在庫を更新
            production_this_shift = {}
            production_detail = []  # ログ用：各設備の生産詳細
            for machine in machines:
                plan_list = [p for p in machine_plans[machine.id]
                           if p['date'] == date and p['shift'] == shift]

                if plan_list:
                    plan = plan_list[0]
                    item_name = plan['item_name']
                    mold_count = plan.get('mold_count', 0)

                    # 品番と鋳造機のペアでデータを取得
                    key = f"{item_name}_{machine.id}"
                    data = item_data.get(key)

                    if not data or data['tact'] == 0:
                        continue

                    # 生産台数を計算（型替え時間を考慮）
                    changeover_time = plan.get('changeover_time', 0)
                    working_time = BASE_TIME[shift] - plan['stop_time'] - changeover_time + plan['overtime']

                    # 稼働時間がマイナスにならないようにする
                    if working_time < 0:
                        working_time = 0

                    production = math.floor(
                        (working_time / data['tact']) * occupancy_rate * data['yield_rate']
                    )

                    if item_name in production_this_shift:
                        production_this_shift[item_name] += production
                    else:
                        production_this_shift[item_name] = production

                    # ログ用に生産詳細を記録
                    production_detail.append((item_name, machine.name, mold_count, production))

            # ログ: 生産処理
            log_file.write("--- 生産処理 ---\n")
            for item_name, machine_name, mold_count, production in production_detail:
                before_stock = inventory.get(item_name, 0) - delivery_this_shift.get(item_name, 0)
                after_stock = before_stock + production
                log_file.write(f"  {item_name} (##{machine_name}, 型数={mold_count}): {before_stock} → {after_stock} (生産: {production}台)\n")
            log_file.write("\n")

            # 在庫を更新
            for item_name in all_item_names:
                production = production_this_shift.get(item_name, 0)
                delivery = delivery_this_shift.get(item_name, 0)
                inventory[item_name] = inventory[item_name] + production - delivery

            # ログ: 直後の在庫
            log_file.write("--- 直後の在庫 ---\n")
            for item_name in sorted(all_item_names):
                log_file.write(f"  {item_name}: {inventory.get(item_name, 0)} 台\n")
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

                            print(f"DEBUG: 夜勤チェック {date} night -> {next_date} day, machine={machine.name}, night_item={night_item}, day_item={day_item}, night_changeover={night_changeover}, night_mold_count={night_mold_count}")

                            # 品番が異なる場合は夜勤で型替え
                            if night_item != day_item:
                                print(f"  -> 型替え検出（品番変更）")

                                # 夜勤で既に型替え時間が設定されている場合（6直目）は追加不要
                                if night_changeover == 0:
                                    # 型替え時間を設定（夜勤で型替えが発生）
                                    night_plans[0]['changeover_time'] = CHANGEOVER_TIME
                                    print(f"  -> 夜勤に型替え時間設定")
                                else:
                                    print(f"  -> 夜勤で既に型替え済み")

                                # 夜勤で型替えするため、残業禁止
                                night_plans[0]['overtime'] = 0

                                # 次の日勤の型替え時間はクリア（夜勤で型替え済み）
                                if day_plans[0].get('changeover_time', 0) > 0:
                                    day_plans[0]['changeover_time'] = 0
                                    print(f"  -> 次の日勤の型替え時間をクリア")

                                # mold_countはそのまま（既に正しい値が設定されている）
                                print(f"  -> 次の日勤のmold_count={day_plans[0].get('mold_count', 0)} (変更なし)")
                            elif night_item == day_item:
                                print(f"  -> 品番継続（型替えなし）")

            # 日勤→夜勤の品番変更チェック
            print("=== 日勤→夜勤 品番変更チェック開始 ===")
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
                        day_mold_count = day_plans[0].get('mold_count', 0)

                        print(f"DEBUG: 日勤チェック {date} day -> night, machine={machine.name}, day_item={day_item}, night_item={night_item}, day_changeover={day_changeover}, day_mold_count={day_mold_count}")

                        # 品番が異なる場合は日勤で型替え
                        if day_item != night_item:
                            print(f"  -> 型替え検出（品番変更）")

                            # 日勤で既に型替え時間が設定されている場合（6直目）は追加不要
                            if day_changeover == 0:
                                # 型替え時間を設定（日勤で型替えが発生）
                                day_plans[0]['changeover_time'] = CHANGEOVER_TIME
                                print(f"  -> 日勤に型替え時間設定")
                            else:
                                print(f"  -> 日勤で既に型替え済み")

                            # mold_countはそのまま（既に正しい値が設定されている）
                            print(f"  -> 次の夜勤のmold_count={night_plans[0].get('mold_count', 0)} (変更なし)")
                        elif day_item == night_item:
                            print(f"  -> 品番継続（型替えなし）")

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
                print(f"DEBUG machine_plans: 10/6 day {machine.name} {plan['item_name']} mold_count={plan.get('mold_count', 'MISSING')}")

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

        # デバッグ: 最初の5件と金曜夜勤を確認
        if result:
            import json
            print("=== Auto Plan Result (first 5) ===")
            print(json.dumps(result[:5], indent=2, ensure_ascii=False))

            # 金曜夜勤のデータを確認
            friday_nights = [r for r in result if r['date'] == '2025-10-03' and r['shift'] == 'night']
            if friday_nights:
                print("=== Friday Night (2025-10-03) ===")
                print(json.dumps(friday_nights, indent=2, ensure_ascii=False))

            # 月曜日勤のデータを確認（型替え時間があるはず）
            monday_days = [r for r in result if r['date'] == '2025-10-06' and r['shift'] == 'day']
            if monday_days:
                print("=== Monday Day (2025-10-06) ===")
                print(json.dumps(monday_days, indent=2, ensure_ascii=False))

            # 10/10夜勤と10/13日勤を確認
            oct10_nights = [r for r in result if r['date'] == '2025-10-10' and r['shift'] == 'night']
            if oct10_nights:
                print("=== 10/10 Night ===")
                for r in oct10_nights:
                    if r['machine_name'] in ['#3', '#4']:
                        print(json.dumps(r, indent=2, ensure_ascii=False))

            oct13_days = [r for r in result if r['date'] == '2025-10-13' and r['shift'] == 'day']
            if oct13_days:
                print("=== 10/13 Day ===")
                for r in oct13_days:
                    if r['machine_name'] in ['#3', '#4']:
                        print(json.dumps(r, indent=2, ensure_ascii=False))

        # ログファイルを閉じる
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("計画完了\n")
        log_file.write("=" * 80 + "\n")
        log_file.close()
        print(f"在庫シミュレーションログを出力しました: {log_file_path}")

        return result

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
                    changeover_time = plan.get('changeover_time', 0)
                    working_time = BASE_TIME[shift] - plan['stop_time'] - changeover_time + plan['overtime']

                    if working_time < 0:
                        working_time = 0

                    production = math.floor(
                        (working_time / data['tact']) * occupancy_rate * data['yield_rate']
                    )

                    if item_name in production_this_shift:
                        production_this_shift[item_name] += production
                    else:
                        production_this_shift[item_name] = production

            # 在庫を更新
            for item_name in all_item_names:
                production = production_this_shift.get(item_name, 0)
                delivery_key = (date, shift, item_name)
                delivery = delivery_dict.get(delivery_key, 0)

                current_stock = inventory[item_name]
                future_stock = current_stock + production - delivery
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
