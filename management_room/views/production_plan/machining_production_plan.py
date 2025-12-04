from management_room.models import DailyMachiningProductionPlan, MachiningItem, AssemblyItemMachiningItemMap, DailyAssenblyProductionPlan, MachiningStock
from manufacturing.models import MachiningLine
from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render
from django.http import JsonResponse
from datetime import datetime
import json
from utils.days_in_month_dates import days_in_month_dates


class MachiningProductionPlanView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/machining_production_plan.html'

    # 定数
    REGULAR_TIME_DAY = 455
    REGULAR_TIME_NIGHT = 450
    OVERTIME_ROUND_MINUTES = 5

    def get(self, request, *args, **kwargs):
        if request.GET.get('year') and request.GET.get('month'):
            year = int(request.GET.get('year'))
            month = int(request.GET.get('month'))
        else:
            year = datetime.now().year
            month = datetime.now().month

        # 対象月の日付リストを作成
        date_list = days_in_month_dates(year, month)

        # 加工ライン名でフィルタリング
        if request.GET.get('line_name'):
            line_name = request.GET.get('line_name')
        else:
            # デフォルトは最初の加工ライン名
            first_line = MachiningLine.objects.filter(active=True).order_by('name', 'assembly__order', 'order').first()
            line_name = first_line.name if first_line else None

        if not line_name:
            # ラインが存在しない場合のエラーハンドリング
            context = {
                'year': year,
                'month': month,
                'line_name': '',
                'lines_data': [],
                'item_names': [],
                'line_names_list': [],
                'inventory_comparison': [],
                'previous_month_stocks_json': json.dumps({}),
            }
            return render(request, self.template_file, context)

        # 同じ加工ライン名の全MachiningLineレコードを取得
        lines = MachiningLine.objects.select_related('assembly').filter(
            name=line_name,
            active=True
        ).order_by('assembly__order', 'order')

        # 加工ライン名のユニークリストを取得（select用）
        all_lines = MachiningLine.objects.filter(active=True).values('name').distinct()
        line_names_list = [line['name'] for line in all_lines]

        # 全MachiningLineの品番を取得（在庫管理用に全品番が必要）
        all_items_for_line_name = MachiningItem.objects.filter(
            line__in=lines,
            active=True
        ).values('name').distinct().order_by('name')
        all_item_names = [item['name'] for item in all_items_for_line_name]

        # 前月末の在庫を取得（加工ライン名で共有）
        from datetime import date

        first_day_of_month = date(year, month, 1)

        previous_month_stocks = {}
        for item_name in all_item_names:
            # 前月の最後の在庫データを取得（idが最新のものを取得）
            last_stock = MachiningStock.objects.filter(
                line_name=line_name,
                item_name=item_name,
                date__lt=first_day_of_month
            ).order_by('-id').first()

            if last_stock and last_stock.stock is not None:
                previous_month_stocks[item_name] = last_stock.stock
            else:
                previous_month_stocks[item_name] = 0

        # 在庫データはDBから読み込まず、常にフロントエンドで計算
        # （翌月の前月末在庫として使用するため、保存のみ行う）

        # 組付側の出庫数を取得（全line共通）
        has_multiple_lines = len(lines) > 1
        machining_to_assembly_map, assembly_plans_map_for_all, assembly_shipment_map = self._get_assembly_shipment_data(
            lines, date_list, all_item_names
        )

        # 複数ラインがある場合、残業時間が均等になるように振り分ける
        allocated_shipment_map = {}  # {(line_id, date, shift, item_name): allocated_quantity}

        if has_multiple_lines and assembly_shipment_map:
            # 残業時間均等化アルゴリズム
            allocated_shipment_map = self._allocate_shipment_to_minimize_overtime(
                lines, date_list, assembly_shipment_map, all_item_names
            )

        # 各MachiningLineごとのデータを生成
        lines_data = []
        for line in lines:
            # このMachiningLineで作れる品番を取得
            items = MachiningItem.objects.filter(line=line, active=True).values('name', 'order').distinct().order_by('order')
            item_names = [item['name'] for item in items]
            item_length = len(item_names)

            # このMachiningLineの生産計画データを取得
            plans = DailyMachiningProductionPlan.objects.filter(
                line=line,
                date__gte=date_list[0],
                date__lte=date_list[-1]
            ).select_related('production_item').order_by('date', 'shift', 'production_item')

            # コンロッドラインでデータがない場合、ヘッドラインの残業時間・計画停止・定時休出情報を取得
            # 注意: 稼働率はコンロッドライン自身のものを使用
            head_data_map = {}  # {(date, shift): {'overtime': x, 'stop_time': y, 'regular_working_hours': bool}}
            if line_name == 'コンロッド' and not plans.exists():
                # ヘッドラインを取得
                head_lines = MachiningLine.objects.filter(
                    name='ヘッド',
                    active=True
                ).order_by('assembly__order', 'order')

                if head_lines.exists():
                    # ヘッドラインの最初のラインのデータを取得（日付・シフトベース）
                    head_line = head_lines.first()
                    head_plans = DailyMachiningProductionPlan.objects.filter(
                        line=head_line,
                        date__gte=date_list[0],
                        date__lte=date_list[-1]
                    ).order_by('date', 'shift')

                    # 日付・シフトごとに最初に見つかったデータを使用（品番は無視）
                    for plan in head_plans:
                        key = (plan.date, plan.shift)
                        if key not in head_data_map:
                            head_data_map[key] = {
                                'overtime': plan.overtime,
                                'stop_time': plan.stop_time,
                                'regular_working_hours': plan.regular_working_hours
                            }

            default_occupancy_rate = (line.occupancy_rate * 100) if line.occupancy_rate else ''

            plans_map = {
                (plan.date, plan.shift, plan.production_item.name): plan
                for plan in plans
                if plan.production_item and plan.shift
            }

            # 日付ベースのデータ構造を構築
            dates_data = []
            for date in date_list:
                date_info = {
                    'date': date,
                    'day': date.day,
                    'weekday': date.weekday(),
                    'is_weekend': date.weekday() >= 5,
                    'occupancy_rate': default_occupancy_rate,
                    'regular_working_hours': False,
                    'has_data': False,
                    'shifts': {
                        'day': {'items': {}, 'stop_time': 0, 'overtime': None},
                        'night': {'items': {}, 'stop_time': 0, 'overtime': None}
                    }
                }

                first_plan_for_common = None

                for shift in ['day', 'night']:
                    first_plan_for_shift = None
                    for item_name in item_names:
                        # 出庫数は常に組付けの生産数から計算（DBの値は使用しない）
                        allocated_qty = self._get_shipment_for_item(
                            line, date, shift, item_name, has_multiple_lines,
                            allocated_shipment_map, assembly_shipment_map
                        )

                        # コンロッドラインの場合、出庫数を3倍にする
                        if line_name == 'コンロッド' and allocated_qty is not None:
                            allocated_qty = allocated_qty * 3

                        # 既存の生産計画データから生産数を取得
                        key = (date, shift, item_name)
                        production_qty = None
                        if key in plans_map:
                            plan = plans_map[key]
                            production_qty = plan.production_quantity
                            date_info['has_data'] = True

                            if first_plan_for_common is None:
                                first_plan_for_common = plan

                            if first_plan_for_shift is None:
                                first_plan_for_shift = plan

                        # 組付側の出庫数がある場合、has_dataをTrueに設定（土日の休出表示のため）
                        if allocated_qty is not None and allocated_qty > 0:
                            date_info['has_data'] = True

                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': production_qty,
                            'shipment': allocated_qty  # 出庫数は常に組付けから計算
                        }

                    # シフトデータを設定（コンロッドでデータがない場合はヘッドのデータを使用）
                    if first_plan_for_shift:
                        date_info['shifts'][shift]['stop_time'] = first_plan_for_shift.stop_time if first_plan_for_shift.stop_time is not None else 0
                        date_info['shifts'][shift]['overtime'] = first_plan_for_shift.overtime
                    elif (date, shift) in head_data_map:
                        # ヘッドラインのデータを使用
                        head_data = head_data_map[(date, shift)]
                        date_info['shifts'][shift]['stop_time'] = head_data['stop_time'] if head_data['stop_time'] is not None else 0
                        date_info['shifts'][shift]['overtime'] = head_data['overtime']
                        # ヘッドラインからデータを取得した場合もhas_dataをTrueに設定
                        if head_data['overtime'] is not None or head_data['stop_time']:
                            date_info['has_data'] = True

                # 共通データを設定
                if first_plan_for_common:
                    # DBにデータがある場合はそれを使用
                    if first_plan_for_common.occupancy_rate is not None:
                        date_info['occupancy_rate'] = first_plan_for_common.occupancy_rate * 100
                    date_info['regular_working_hours'] = first_plan_for_common.regular_working_hours
                elif head_data_map:
                    # コンロッドでデータがない場合、定時・休出情報のみヘッドラインから取得
                    # 稼働率はコンロッドライン自身のdefault_occupancy_rateを使用（既に設定済み）
                    if (date, 'day') in head_data_map:
                        head_data = head_data_map[(date, 'day')]
                        date_info['regular_working_hours'] = head_data['regular_working_hours']

                dates_data.append(date_info)

            # 振り分けられた数量がある場合、残業時間を計算
            if assembly_shipment_map or allocated_shipment_map:
                self._calculate_overtime_for_dates(dates_data, line, item_names)

            # 在庫データはフロントエンドで計算するため、初期値はNone

            # 組付側の週末休出日チェック
            for date_info in dates_data:
                date = date_info['date']
                has_assembly_weekend_work = False
                for shift in ['day', 'night']:
                    for item_name in item_names:
                        assembly_items = machining_to_assembly_map.get(item_name, [])
                        for assembly_item_name, assembly_line_id in assembly_items:
                            key = (date, shift, assembly_line_id, assembly_item_name)
                            if key in assembly_plans_map_for_all:
                                assembly_plan = assembly_plans_map_for_all[key]
                                if date_info['is_weekend'] and assembly_plan.production_quantity and assembly_plan.production_quantity > 0:
                                    has_assembly_weekend_work = True
                                    break
                        if has_assembly_weekend_work:
                            break
                    if has_assembly_weekend_work:
                        break

                date_info['has_assembly_weekend_work'] = has_assembly_weekend_work

            # このMachiningLineのタクトと良品率
            item_data_dict = {
                'tact': float(line.tact) if line.tact else 0,
                'yield_rate': float(line.yield_rate) if line.yield_rate else 1.0
            }
            item_data_json = json.dumps(item_data_dict)

            lines_data.append({
                'line': line,
                'dates_data': dates_data,
                'item_data': item_data_json,
                'assembly_name': line.assembly.name if line.assembly else '',
                'item_names': item_names,
                'item_length': item_length,
                'rowspan_count': item_length * 2,
            })

        # 月末在庫と適正在庫を比較（全品番）
        # 月末在庫はフロントエンドで計算されるため、初期値は0
        inventory_comparison = []
        for item_name in all_item_names:
            # 品番の適正在庫は最初に見つかったMachiningItemから取得
            machining_item = MachiningItem.objects.filter(
                line__in=lines,
                name=item_name,
                active=True
            ).first()

            optimal_inventory = machining_item.optimal_inventory if machining_item and machining_item.optimal_inventory is not None else 0

            # 月末在庫はフロントエンドで計算
            end_of_month_stock = 0
            difference = end_of_month_stock - optimal_inventory

            inventory_comparison.append({
                'name': item_name,
                'optimal_inventory': optimal_inventory,
                'end_of_month_stock': end_of_month_stock,
                'difference': difference
            })

        context = {
            'year': year,
            'month': month,
            'line_name': line_name,
            'lines_data': lines_data,
            'all_item_names': all_item_names,  # 全品番（在庫計算用）
            'line_names_list': line_names_list,  # 加工ライン名リスト
            'previous_month_stocks_json': json.dumps(previous_month_stocks),  # 前月末在庫
            'inventory_comparison': inventory_comparison,  # 適正在庫
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """加工生産計画データを保存"""
        try:
            # JSONデータを取得
            data = json.loads(request.body)
            lines_data_list = data.get('lines_data', [])
            dates_to_delete = data.get('dates_to_delete', [])

            # 対象期間を取得
            if request.GET.get('year') and request.GET.get('month'):
                year = int(request.GET.get('year'))
                month = int(request.GET.get('month'))
            else:
                year = datetime.now().year
                month = datetime.now().month

            # 加工ライン名を取得
            if request.GET.get('line_name'):
                line_name = request.GET.get('line_name')
            else:
                first_line = MachiningLine.objects.filter(active=True).order_by('name').first()
                line_name = first_line.name if first_line else None

            if not line_name:
                return JsonResponse({'status': 'error', 'message': 'ラインが見つかりません'}, status=400)

            # 同じ加工ライン名の全MachiningLineレコードを取得
            lines = MachiningLine.objects.filter(name=line_name, active=True).order_by('assembly__order', 'order')

            # 日付リストを生成
            dates = days_in_month_dates(year, month)

            # ユーザー名を取得
            username = request.user.username if request.user.is_authenticated else 'system'

            # 削除対象の日付のデータを削除（全MachiningLineから）
            deleted_count = 0
            if dates_to_delete:
                delete_dates = [dates[idx] for idx in dates_to_delete if idx < len(dates)]
                deleted_count = DailyMachiningProductionPlan.objects.filter(
                    line__in=lines,
                    date__in=delete_dates
                ).delete()[0]

            # 各MachiningLineごとに保存処理
            total_plans_to_update = []
            total_plans_to_create = []
            total_stocks_to_update = []
            total_stocks_to_create = []

            for line_data_idx, line_data in enumerate(lines_data_list):
                if line_data_idx >= len(lines):
                    continue

                line = list(lines)[line_data_idx]
                dates_data = line_data.get('dates_data', [])

                # 品番リストを取得
                items = MachiningItem.objects.filter(line=line, active=True).values_list('pk', 'name')
                item_dict = {item_name: item_pk for item_pk, item_name in items}

                # 既存データを取得
                existing_plans_list = DailyMachiningProductionPlan.objects.filter(
                    line=line,
                    date__in=dates
                ).select_related('production_item')

                existing_plans = {
                    (plan.date, plan.shift, plan.production_item_id): plan
                    for plan in existing_plans_list
                }

                # 日付ベースでデータを処理
                for date_info in dates_data:
                    date_index = date_info.get('date_index')
                    if date_index >= len(dates):
                        continue

                    date_obj = dates[date_index]
                    occupancy_rate = date_info.get('occupancy_rate')
                    regular_working_hours = date_info.get('regular_working_hours', False)
                    shifts = date_info.get('shifts', {})

                    for shift_name, shift_data in shifts.items():
                        stop_time = shift_data.get('stop_time', 0)
                        overtime = shift_data.get('overtime', 0)
                        items_data = shift_data.get('items', {})

                        for item_name, item_data in items_data.items():
                            item_pk = item_dict.get(item_name)
                            if not item_pk:
                                continue

                            # 生産数はDBに保存
                            production_quantity = item_data.get('production_quantity', 0) if isinstance(item_data, dict) else item_data
                            # 出庫数は保存しない（常に組付けから計算）

                            key = (date_obj, shift_name, item_pk)
                            existing_plan = existing_plans.get(key)

                            if existing_plan:
                                existing_plan.production_quantity = production_quantity
                                existing_plan.stop_time = stop_time
                                existing_plan.overtime = overtime
                                existing_plan.occupancy_rate = (occupancy_rate / 100) if occupancy_rate is not None else None
                                existing_plan.regular_working_hours = regular_working_hours
                                existing_plan.last_updated_user = username
                                total_plans_to_update.append(existing_plan)
                            else:
                                total_plans_to_create.append(DailyMachiningProductionPlan(
                                    line=line,
                                    production_item_id=item_pk,
                                    date=date_obj,
                                    shift=shift_name,
                                    production_quantity=production_quantity,
                                    stop_time=stop_time,
                                    overtime=overtime,
                                    occupancy_rate=(occupancy_rate / 100) if occupancy_rate is not None else None,
                                    regular_working_hours=regular_working_hours,
                                    last_updated_user=username
                                ))

            # 一括更新・作成
            if total_plans_to_update:
                DailyMachiningProductionPlan.objects.bulk_update(
                    total_plans_to_update,
                    ['production_quantity', 'stop_time', 'overtime', 'occupancy_rate', 'regular_working_hours', 'last_updated_user']
                )

            if total_plans_to_create:
                DailyMachiningProductionPlan.objects.bulk_create(total_plans_to_create)

            # 在庫データを保存（加工ライン名で共有）
            # ★重要: 在庫はフロントエンドで計算され、翌月の前月末在庫として使用するためDBに保存
            # 最初のMachiningLineのdates_dataから在庫データを取得
            if lines_data_list:
                first_line_data = lines_data_list[0]
                dates_data = first_line_data.get('dates_data', [])

                # 品番リストを取得（最初のMachiningLineから）
                first_line = list(lines)[0]
                items = MachiningItem.objects.filter(line=first_line, active=True).values_list('pk', 'name')
                item_dict = {item_name: item_pk for item_pk, item_name in items}

                existing_stocks_list = MachiningStock.objects.filter(
                    line_name=line_name,
                    date__in=dates,
                    item_name__in=item_dict.keys()
                )

                existing_stocks = {
                    (stock.date, stock.shift, stock.item_name): stock
                    for stock in existing_stocks_list
                }

                for date_info in dates_data:
                    date_index = date_info.get('date_index')
                    if date_index >= len(dates):
                        continue

                    date_obj = dates[date_index]
                    shifts = date_info.get('shifts', {})

                    for shift_name, shift_data in shifts.items():
                        items_data = shift_data.get('items', {})

                        for item_name, item_data in items_data.items():
                            if item_name not in item_dict:
                                continue

                            stock_value = item_data.get('stock') if isinstance(item_data, dict) else None

                            if stock_value is None:
                                continue

                            key = (date_obj, shift_name, item_name)
                            existing_stock = existing_stocks.get(key)

                            if existing_stock:
                                existing_stock.stock = stock_value
                                existing_stock.last_updated_user = username
                                total_stocks_to_update.append(existing_stock)
                            else:
                                total_stocks_to_create.append(MachiningStock(
                                    line_name=line_name,
                                    item_name=item_name,
                                    date=date_obj,
                                    shift=shift_name,
                                    stock=stock_value,
                                    last_updated_user=username
                                ))

                if total_stocks_to_update:
                    MachiningStock.objects.bulk_update(
                        total_stocks_to_update,
                        ['stock', 'last_updated_user']
                    )

                if total_stocks_to_create:
                    MachiningStock.objects.bulk_create(total_stocks_to_create)

            message = '保存しました'

            return JsonResponse({
                'status': 'success',
                'message': message
            })

        except Exception as e:
            import traceback
            return JsonResponse({
                'status': 'error',
                'message': str(e),
                'traceback': traceback.format_exc()
            }, status=400)

    def _get_shipment_for_item(self, line, date, shift, item_name, has_multiple_lines,
                                allocated_shipment_map, assembly_shipment_map):
        """
        指定された品番の出庫数を取得（組付けの生産数から計算）

        Args:
            line: MachiningLineオブジェクト
            date: 日付
            shift: シフト（'day' or 'night'）
            item_name: 品番
            has_multiple_lines: 複数ラインがあるか
            allocated_shipment_map: 振り分け済み出庫数マップ
            assembly_shipment_map: 組付け側出庫数マップ

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

    def _allocate_shipment_to_minimize_overtime(self, lines, date_list, assembly_shipment_map, all_item_names):
        """
        残業時間が均等になるように出庫数を振り分ける（振り分けページのアルゴリズムを移植）

        Args:
            lines: MachiningLineのリスト
            date_list: 日付のリスト
            assembly_shipment_map: {(date, shift, item_name): total_shipment}
            all_item_names: 全品番のリスト

        Returns:
            allocated_shipment_map: {(line_id, date, shift, item_name): allocated_quantity}
        """
        REGULAR_TIME_DAY = 455
        REGULAR_TIME_NIGHT = 450

        allocated_shipment_map = {}

        # 各ラインの情報を準備
        lines_info = {}
        for line in lines:
            lines_info[line.id] = {
                'line': line,
                'tact': float(line.tact) if line.tact else 0,
                'occupancy_rate': float(line.occupancy_rate) if line.occupancy_rate else 1.0,
                'items': set(
                    MachiningItem.objects.filter(line=line, active=True).values_list('name', flat=True)
                )
            }

        # 日付・シフトごとに振り分け
        for date in date_list:
            for shift in ['day', 'night']:
                regular_time = REGULAR_TIME_DAY if shift == 'day' else REGULAR_TIME_NIGHT

                # 各ラインの現在の状態を初期化
                line_status = {}
                for line_id, info in lines_info.items():
                    available_time = regular_time * info['occupancy_rate']
                    line_status[line_id] = {
                        'current_production': 0,
                        'current_required_time': 0,
                        'current_overtime': 0,
                        'available_time': available_time,
                        'tact': info['tact']
                    }

                # 品番を固定品番と柔軟な品番に分類
                fixed_items, flexible_items = self._classify_items(
                    all_item_names, assembly_shipment_map, lines_info, date, shift
                )

                # 固定品番を先に割り当て
                self._allocate_fixed_items(fixed_items, allocated_shipment_map, line_status, date, shift)

                # 柔軟な品番を残業時間が均等になるように割り当て
                self._allocate_flexible_items(flexible_items, allocated_shipment_map, line_status, date, shift)

        return allocated_shipment_map

    def _get_assembly_shipment_data(self, lines, date_list, all_item_names):
        """
        組付側の出庫数データを取得

        Returns:
            tuple: (machining_to_assembly_map, assembly_plans_map_for_all, assembly_shipment_map)
        """
        machining_to_assembly_map = {}
        assembly_shipment_map = {}

        # AssemblyItemMachiningItemMapから紐づきを取得
        machining_items_for_all = MachiningItem.objects.filter(
            line__in=lines,
            active=True,
            name__in=all_item_names
        )
        assembly_mappings_for_all = AssemblyItemMachiningItemMap.objects.filter(
            machining_item__in=machining_items_for_all,
            active=True
        ).select_related('assembly_item', 'assembly_item__line', 'machining_item')

        for mapping in assembly_mappings_for_all:
            machining_name = mapping.machining_item.name
            assembly_name = mapping.assembly_item.name
            assembly_line_id = mapping.assembly_item.line_id
            if machining_name not in machining_to_assembly_map:
                machining_to_assembly_map[machining_name] = []
            machining_to_assembly_map[machining_name].append((assembly_name, assembly_line_id))

        # 組付生産計画を取得
        assembly_items_info_for_all = [
            (name, line_id)
            for items in machining_to_assembly_map.values()
            for name, line_id in items
        ]
        assembly_item_names_for_all = [name for name, _ in assembly_items_info_for_all]

        assembly_plans_for_all = DailyAssenblyProductionPlan.objects.filter(
            date__gte=date_list[0],
            date__lte=date_list[-1],
            production_item__name__in=assembly_item_names_for_all
        ).select_related('production_item', 'line')

        assembly_plans_map_for_all = {
            (plan.date, plan.shift, plan.line_id, plan.production_item.name): plan
            for plan in assembly_plans_for_all
            if plan.production_item and plan.shift and plan.line_id
        }

        # 組付側の出庫数を集計
        for date in date_list:
            for shift in ['day', 'night']:
                for item_name in all_item_names:
                    total_assembly_shipment = 0
                    assembly_items = machining_to_assembly_map.get(item_name, [])
                    for assembly_item_name, assembly_line_id in assembly_items:
                        key = (date, shift, assembly_line_id, assembly_item_name)
                        if key in assembly_plans_map_for_all:
                            assembly_plan = assembly_plans_map_for_all[key]
                            total_assembly_shipment += assembly_plan.production_quantity or 0

                    if total_assembly_shipment > 0:
                        assembly_shipment_map[(date, shift, item_name)] = total_assembly_shipment

        return machining_to_assembly_map, assembly_plans_map_for_all, assembly_shipment_map

    def _calculate_overtime_for_dates(self, dates_data, line, item_names):
        """残業時間を計算（DBに保存されていない場合のみ）"""
        for date_info in dates_data:
            for shift in ['day', 'night']:
                # DBに既に残業時間が保存されている場合はスキップ
                if date_info['shifts'][shift].get('overtime') is not None:
                    continue

                # この直の全品番の生産数を合計
                total_production = 0
                for item_name in item_names:
                    item = date_info['shifts'][shift]['items'].get(item_name)
                    if item and item.get('production_quantity') is not None:
                        total_production += item['production_quantity']

                # 生産数がない場合は残業0
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
                regular_time = self.REGULAR_TIME_DAY if shift == 'day' else self.REGULAR_TIME_NIGHT
                stop_time = date_info['shifts'][shift].get('stop_time', 0)

                required_time = total_production * tact
                available_time = (regular_time - stop_time) * occupancy_rate
                overtime_minutes = max(0, required_time - available_time)

                # 5分刻みに切り上げ
                overtime = int((overtime_minutes + self.OVERTIME_ROUND_MINUTES - 1) // self.OVERTIME_ROUND_MINUTES * self.OVERTIME_ROUND_MINUTES)
                date_info['shifts'][shift]['overtime'] = overtime

    def _classify_items(self, all_item_names, assembly_shipment_map, lines_info, date, shift):
        """品番を固定品番と柔軟な品番に分類"""
        fixed_items = []
        flexible_items = []

        for item_name in all_item_names:
            shipment_key = (date, shift, item_name)
            total_shipment = assembly_shipment_map.get(shipment_key, 0)

            if total_shipment == 0:
                continue

            # この品番を作れるラインを取得
            available_lines = [
                line_id for line_id, info in lines_info.items()
                if item_name in info['items']
            ]

            if len(available_lines) == 0:
                continue
            elif len(available_lines) == 1:
                # 固定品番（1つのラインでしか作れない）
                fixed_items.append({
                    'item_name': item_name,
                    'total_shipment': total_shipment,
                    'line_id': available_lines[0]
                })
            else:
                # 柔軟な品番（複数ラインで作れる）
                flexible_items.append({
                    'item_name': item_name,
                    'total_shipment': total_shipment,
                    'available_lines': available_lines
                })

        return fixed_items, flexible_items

    def _allocate_fixed_items(self, fixed_items, allocated_shipment_map, line_status, date, shift):
        """固定品番を割り当て"""
        for item in fixed_items:
            alloc_key = (item['line_id'], date, shift, item['item_name'])
            allocated_shipment_map[alloc_key] = item['total_shipment']

            # ライン状態を更新
            line_status[item['line_id']]['current_production'] += item['total_shipment']
            line_status[item['line_id']]['current_required_time'] += item['total_shipment'] * line_status[item['line_id']]['tact']
            line_status[item['line_id']]['current_overtime'] = max(
                0,
                line_status[item['line_id']]['current_required_time'] - line_status[item['line_id']]['available_time']
            )

    def _allocate_flexible_items(self, flexible_items, allocated_shipment_map, line_status, date, shift):
        """柔軟な品番を残業時間が均等になるように割り当て"""
        for item in flexible_items:
            remaining = item['total_shipment']
            available_lines = item['available_lines']

            while remaining > 0:
                # 各ラインに割り振った場合の残業時間差を計算
                min_diff = float('inf')
                target_line_id = None

                for line_id in available_lines:
                    status = line_status[line_id]
                    new_required_time = status['current_required_time'] + status['tact']
                    new_overtime = max(0, new_required_time - status['available_time'])

                    # 他のラインとの残業時間の最大差を計算
                    max_diff = 0
                    for other_line_id in available_lines:
                        if other_line_id == line_id:
                            continue
                        other_overtime = line_status[other_line_id]['current_overtime']
                        diff = abs(new_overtime - other_overtime)
                        max_diff = max(max_diff, diff)

                    if max_diff < min_diff:
                        min_diff = max_diff
                        target_line_id = line_id

                if target_line_id is None:
                    # フォールバック: 最初のラインに全て割り当て
                    target_line_id = available_lines[0]

                # 割り当て
                alloc_key = (target_line_id, date, shift, item['item_name'])
                allocated_shipment_map[alloc_key] = allocated_shipment_map.get(alloc_key, 0) + 1

                # ライン状態を更新
                line_status[target_line_id]['current_production'] += 1
                line_status[target_line_id]['current_required_time'] += line_status[target_line_id]['tact']
                line_status[target_line_id]['current_overtime'] = max(
                    0,
                    line_status[target_line_id]['current_required_time'] - line_status[target_line_id]['available_time']
                )

                remaining -= 1
