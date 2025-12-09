from management_room.models import DailyMachineCVTProductionPlan, DailyCVTProductionPlan, CVTItem, CVTItemMachineMap
from manufacturing.models import CVTLine, CVTMachine
from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render
from django.http import JsonResponse
from datetime import datetime, timedelta, date
from dateutil.relativedelta import relativedelta
import json
import calendar
from utils.days_in_month_dates import days_in_month_dates

class CVTProductionPlanView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/cvt_production_plan.html'

    def get(self, request, *args, **kwargs):
        if request.GET.get('year') and request.GET.get('month'):
            year = int(request.GET.get('year'))
            month = int(request.GET.get('month'))
        else:
            year = datetime.now().year
            month = datetime.now().month

        # 対象月の日付リストを作成
        date_list = days_in_month_dates(year, month)
        start_date = date_list[0]
        end_date = date_list[-1]

        # CVTラインを取得
        if request.GET.get('line'):
            line = CVTLine.objects.get(id=request.GET.get('line'))
        else:
            line = CVTLine.objects.filter(active=True).order_by('name').first()

        # 品番を取得（一覧から重複なし）
        cvt_item = CVTItem.objects.filter(line=line, active=True)
        item_names = [ item.name for item in cvt_item ]
        color_dict = {item.name: item.color for item in cvt_item}

        item_names = list(CVTItem.objects.filter(line=line, active=True).values_list('name', flat=True).distinct())

        # CVT鋳造機を取得
        machine_list = list(CVTMachine.objects.filter(line=line, active=True).order_by('name').values('name', 'id'))

        # データを取得（当月の全データを1回のクエリで取得）
        plans = DailyMachineCVTProductionPlan.objects.filter(
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

        # 日付リストを生成
        dates = []
        for current_date in date_list:
            is_weekend = current_date.weekday() >= 5
            has_weekend_work = current_date in weekend_work_dates if is_weekend else False
            is_regular_hours = regular_working_hours_dict.get(current_date, False)

            dates.append({
                'date': current_date,
                'weekday': current_date.weekday(),
                'is_weekend': is_weekend,
                'occupancy_rate': default_occupancy_rate,
                'has_weekend_work': has_weekend_work,
                'is_regular_hours': is_regular_hours
            })

        # 前月データを取得（在庫のみ）
        first_day_of_month = date(year, month, 1)
        prev_month_last_date = first_day_of_month - relativedelta(days=1)

        # 前月最終日の夜勤の在庫数を品番ごとに取得（DailyCVTProductionPlanから）
        previous_month_inventory = {}
        prev_month_stock_plans = DailyCVTProductionPlan.objects.filter(
            line=line,
            date=prev_month_last_date,
            shift='night'
        ).select_related('production_item')

        for plan in prev_month_stock_plans:
            if plan.production_item and plan.stock:
                item_name = plan.production_item.name
                previous_month_inventory[item_name] = plan.stock

        # 在庫数データを辞書形式で取得
        # DailyCVTProductionPlanから取得
        stock_plans = DailyCVTProductionPlan.objects.filter(
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

                    # 品番ごとのデータを設定（CVTは出庫数なし、在庫のみ）
                    date_data['shifts'][shift]['items'][item_name] = {
                        'inventory': plan.stock if plan and plan.stock is not None else '',  # 在庫数（計算結果）
                        'production': '',  # 生産台数（フロントエンドで計算）
                        'stock_adjustment': plan.stock_adjustment if plan and plan.stock_adjustment is not None else ''  # 在庫調整（手動入力値）
                    }

                # 機械データを処理
                for machine in machine_list:
                    machine_id = machine['id']
                    machine_name = machine['name']

                    # CVT鋳造機の品番リストを取得
                    machine_items = list(CVTItemMachineMap.objects.filter(
                        line=line,
                        machine_id=machine_id,
                        active=True
                    ).order_by('casting_item__name').values_list('casting_item__name', flat=True))

                    plan = plans_dict.get((machine_id, current_date, shift))

                    # 品番選択（CVTは金型管理なし、シンプルに既存データから取得）
                    selected_item = ''
                    if plan and plan.production_item:
                        # 既存の計画から取得
                        selected_item = plan.production_item.name

                    date_data['shifts'][shift]['machines'][machine_name] = {
                        'machine_id': machine_id,
                        'items': machine_items,
                        'stop_time': plan.stop_time if plan and plan.stop_time is not None else (0 if not is_weekend else ''),
                        'overtime': plan.overtime if plan and plan.overtime is not None else (0 if not is_weekend else ''),
                        'selected_item': selected_item
                    }

            dates_data.append(date_data)


        # 品番と設備の組み合わせごとのタクトと良品率を取得（計算用）
        # データ構造: item_data[品番名][設備名] = {tact, yield_rate, molten_metal_usage}
        item_data = {}
        for item_name in item_names:
            item_data[item_name] = {}

            # この品番に対するすべての設備マッピングを取得
            item_maps = CVTItemMachineMap.objects.filter(
                line=line,
                casting_item__name=item_name,
                active=True
            ).select_related('casting_item', 'machine')

            for item_map in item_maps:
                if item_map.machine:
                    machine_name = item_map.machine.name
                    item_data[item_name][machine_name] = {
                        'tact': item_map.tact if item_map.tact else 0,
                        'yield_rate': item_map.yield_rate if item_map.yield_rate else 0,
                        'molten_metal_usage': item_map.casting_item.molten_metal_usage if item_map.casting_item.molten_metal_usage else 0
                    }
        lines_list = list(CVTLine.objects.filter(active=True).order_by('name').values('id', 'name'))

        # 適正在庫と月末在庫を比較
        inventory_comparison = []
        for item_name in item_names:
            # CVT品番の適正在庫を取得
            cvt_item = CVTItem.objects.filter(
                line=line,
                name=item_name,
                active=True
            ).first()

            optimal_inventory = cvt_item.optimal_inventory if cvt_item and cvt_item.optimal_inventory is not None else 0

            # 月末在庫を取得（ページ読み込み時点では0として、JavaScriptで更新）
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
        item_total_rows = len(item_names) * 2  # 品番ごとのセクション（生産台数、在庫）
        machine_total_rows = len(machine_list) * 2  # CVT鋳造機ごとのセクション（生産計画、残業時間、計画停止）

        context = {
            'year': year,
            'month': month,
            'line': line,
            'dates_data': dates_data,  # 新しい日付ベースのデータ構造
            'item_names': item_names,
            'color_dict': color_dict,
            'machines': machine_list,
            'item_data_json': json.dumps(item_data),
            'previous_month_inventory_json': json.dumps(previous_month_inventory),
            'lines': lines_list,
            'inventory_comparison': inventory_comparison,
            'item_total_rows': item_total_rows,  # 品番ごとのセクションの総行数
            'machine_total_rows': machine_total_rows,  # CVT鋳造機ごとのセクションの総行数
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """生産計画データを保存"""
        try:
            # JSONデータを取得
            data = json.loads(request.body)
            plan_data = data.get('plan_data', [])
            weekends_to_delete = data.get('weekends_to_delete', [])
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

            # CVTラインを取得
            if request.GET.get('line'):
                line = CVTLine.objects.get(id=request.GET.get('line'))
            else:
                line = CVTLine.objects.filter(active=True).order_by('name').first()

            # CVT鋳造機リストを取得
            machines = list(CVTMachine.objects.filter(line=line, active=True).order_by('name'))

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
            item_plan_data = {}  # 品番ごとの計画データ（在庫数・出庫数・在庫調整を統合）
            production_data = {}  # 生産台数データ（品番×シフト×日付）

            # ヘルパー関数: item_plan_dataのエントリを初期化
            def ensure_item_plan_entry(date_index, shift, item_name):
                key = f"{date_index}_{shift}_{item_name}"
                if key not in item_plan_data:
                    item_plan_data[key] = {
                        'date_index': date_index,
                        'shift': shift,
                        'item_name': item_name,
                        'stock': None,
                        'stock_adjustment': None
                    }
                return key

            for item in plan_data:
                item_type = item.get('type')

                if item_type in ['inventory', 'stock_adjustment']:
                    # 在庫数・在庫調整データを統合
                    date_index = item.get('date_index')
                    shift = item.get('shift')
                    item_name = item.get('item_name')

                    key = ensure_item_plan_entry(date_index, shift, item_name)

                    if item_type == 'inventory':
                        item_plan_data[key]['stock'] = item.get('stock')
                    elif item_type == 'stock_adjustment':
                        item_plan_data[key]['stock_adjustment'] = item.get('stock_adjustment')
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
                            'item_name': None
                        }

                    if item_type == 'stop_time':
                        grouped_data[key]['stop_time'] = item.get('stop_time')
                    elif item_type == 'overtime':
                        grouped_data[key]['overtime'] = item.get('overtime')
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
                item_name = data['item_name']

                # 日付を取得
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # CVT鋳造機を取得
                if machine_index >= len(machines):
                    continue
                machine = machines[machine_index]

                # 品番を取得
                production_item = None
                if item_name:
                    # CVTItemMachineMapを通じて品番を取得
                    item_map = CVTItemMachineMap.objects.filter(
                        line=line,
                        machine=machine,
                        casting_item__name=item_name,
                        active=True
                    ).select_related('casting_item').first()
                    if item_map:
                        production_item = item_map.casting_item

                # production_itemを条件に含めてupdate_or_create
                if production_item:
                    # 同じCVT鋳造機・日付・シフトの他の品番のレコードをすべて削除
                    DailyMachineCVTProductionPlan.objects.filter(
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
                        'regular_working_hours': regular_working_hours,
                        'last_updated_user': request.user.username if request.user.is_authenticated else 'system'
                    }

                    # 稼働率がある場合のみ設定
                    if occupancy_rate is not None:
                        defaults['occupancy_rate'] = occupancy_rate

                    # 選択された品番のレコードを作成または更新
                    DailyMachineCVTProductionPlan.objects.update_or_create(
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
                    deleted = DailyMachineCVTProductionPlan.objects.filter(
                        line=line,
                        machine=machine,
                        date=date,
                        shift=shift
                    ).delete()
                    if deleted[0] > 0:
                        saved_count += 1
                elif stop_time is not None or overtime is not None:
                    # production_itemがない場合でも、stop_time、overtimeだけ更新（全レコードに適用）
                    update_fields = {}
                    if stop_time is not None:
                        update_fields['stop_time'] = stop_time
                    if overtime is not None:
                        update_fields['overtime'] = overtime

                    if update_fields:
                        updated = DailyMachineCVTProductionPlan.objects.filter(
                            line=line,
                            machine=machine,
                            date=date,
                            shift=shift
                        ).update(**update_fields)
                        if updated > 0:
                            saved_count += updated

            # 在庫数・在庫調整を保存（DailyCVTProductionPlanに統合して保存）
            # 在庫計算式: 在庫数 = 前の直の在庫 + 良品生産数 + 在庫調整
            for key, plan_item in item_plan_data.items():
                date_index = plan_item['date_index']
                shift = plan_item['shift']
                item_name = plan_item['item_name']
                stock = plan_item['stock']  # 在庫数（計算結果）
                stock_adjustment = plan_item['stock_adjustment']  # 在庫調整（棚卸・不良品などの手動調整）

                # 日付を取得
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # 品番を取得
                production_item = CVTItem.objects.filter(
                    line=line,
                    name=item_name,
                    active=True
                ).first()

                if production_item:
                    # defaultsを構築（Noneでない値のみ設定）
                    defaults = {
                        'last_updated_user': request.user.username if request.user.is_authenticated else 'system'
                    }
                    # 在庫数を保存（計算結果）
                    if stock is not None:
                        defaults['stock'] = stock
                    # 在庫調整は0も含めて保存（クリア可能にするため）
                    defaults['stock_adjustment'] = stock_adjustment if stock_adjustment is not None else 0

                    # DailyCVTProductionPlanに在庫数・在庫調整を保存
                    DailyCVTProductionPlan.objects.update_or_create(
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

                # この品番を生産している最初のCVT鋳造機のレコードに生産台数を保存
                production_item = CVTItem.objects.filter(
                    line=line,
                    name=item_name,
                    active=True
                ).first()

                if production_item:
                    # この品番を持つレコードを更新
                    updated = DailyMachineCVTProductionPlan.objects.filter(
                        line=line,
                        date=date,
                        shift=shift,
                        production_item=production_item
                    ).update(production_count=production_count)

                    if updated > 0:
                        saved_count += 1

            # 休日出勤が消された日付のDailyMachineCVTProductionPlanを削除
            deleted_count = 0
            for date_index in weekends_to_delete:
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # 該当日付のDailyMachineCVTProductionPlanを削除（日勤のみ、週末なので）
                deleted = DailyMachineCVTProductionPlan.objects.filter(
                    line=line,
                    date=date,
                    shift='day'
                ).delete()

                if deleted[0] > 0:
                    deleted_count += deleted[0]

            return JsonResponse({
                'status': 'success',
                'message': f'{saved_count}件のデータを保存、{deleted_count}件のデータを削除しました'
            })

        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': str(e)
            }, status=400)
