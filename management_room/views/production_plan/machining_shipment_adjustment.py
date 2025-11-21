from management_room.models import DailyMachiningProductionPlan, MachiningItem, DailyAssenblyProductionPlan, AssemblyItemMachiningItemMap, MachiningStock
from manufacturing.models import MachiningLine, AssemblyLine
from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render
from django.http import JsonResponse
from django.db.models import Count
from datetime import datetime, date, timedelta
import json
import calendar
from utils.days_in_month_dates import days_in_month_dates

# ========================================
# 定数
# ========================================
REGULAR_TIME_MINUTES = 480
OVERTIME_ROUND_MINUTES = 5


class MachiningShipmentAdjustmentView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/machining_shipment_adjustment.html'

    # ========================================
    # ヘルパーメソッド - データ取得
    # ========================================
    def _get_year_month(self, request):
        """年月を取得"""
        if request.GET.get('year') and request.GET.get('month'):
            year = int(request.GET.get('year'))
            month = int(request.GET.get('month'))
        else:
            year = datetime.now().year
            month = datetime.now().month
        return year, month

    def _get_line_types_and_selected(self, request):
        """ラインタイプ一覧と選択されたラインタイプを取得"""
        line_type_counts = MachiningLine.objects.filter(active=True).values('name').annotate(
            count=Count('id')
        ).filter(count__gte=2).order_by('order')

        line_types = [item['name'] for item in line_type_counts]
        default_line_type = line_types[0] if line_types else None
        line_type = request.GET.get('line_type', default_line_type)

        return line_types, line_type

    def get(self, request, *args, **kwargs):
        year, month = self._get_year_month(request)
        date_list = days_in_month_dates(year, month)
        line_types, line_type = self._get_line_types_and_selected(request)

        # 指定されたタイプの加工ラインを全て取得
        machining_lines = MachiningLine.objects.filter(
            name=line_type,
            active=True
        ).select_related('assembly').order_by('assembly__order', 'assembly__name')

        # ラインごとにデータを格納（動的に対応）
        lines_by_assembly = {}  # {assembly_name: line}
        for line in machining_lines:
            if line.assembly:
                lines_by_assembly[line.assembly.name] = line

        # 品番を取得（全ラインの品番を統合）
        item_names_set = set()
        items_by_line = {}  # {assembly_name: set(item_names)}

        for assembly_name, line in lines_by_assembly.items():
            items = MachiningItem.objects.filter(line=line, active=True).values_list('name', flat=True)
            items_set = set(items)
            items_by_line[assembly_name] = items_set
            item_names_set.update(items)

        item_names = sorted(list(item_names_set))

        # 各品番がどのラインで作れるかを記録（動的に対応）
        item_line_info = {}
        for item_name in item_names:
            can_make_on = [assembly_name for assembly_name, items in items_by_line.items() if item_name in items]

            if len(can_make_on) == 1:
                # 1つのラインでしか作れない
                item_line_info[item_name] = can_make_on[0]
            else:
                # 複数のラインで作れる
                item_line_info[item_name] = 'both'

        # 各加工品番のメインラインを取得
        # 同じ名前の加工品番が複数ある場合（#1と#2）、main_line=Trueのものを優先
        item_main_line = {}

        machining_items_with_line = MachiningItem.objects.filter(
            line__name=line_type,
            active=True
        ).select_related('line', 'line__assembly')

        # main_line=Trueを先に処理するためソート
        sorted_items = sorted(machining_items_with_line, key=lambda x: (x.name, not x.main_line))

        for machining_item in sorted_items:
            # 既に設定済みの場合はスキップ（main_line=Trueが優先される）
            if machining_item.name in item_main_line:
                continue

            # lineフィールドのassembly.nameからライン番号を取得（例: "#1", "#2"）
            if machining_item.line and machining_item.line.assembly:
                item_main_line[machining_item.name] = machining_item.line.assembly.name

        # 組付品番と加工品番のマッピングを取得
        # ヘッド、ブロック、クランクの全ての加工品番を取得（#1と#2両方）
        all_machining_items = MachiningItem.objects.filter(
            line__name=line_type,
            active=True,
            name__in=item_names
        )

        assembly_mappings = AssemblyItemMachiningItemMap.objects.filter(
            machining_item__in=all_machining_items,
            active=True
        ).select_related('assembly_item', 'assembly_item__line', 'machining_item')

        # マッピング辞書を作成: {machining_item_name: [(assembly_item_name, assembly_line_id)]}
        machining_to_assembly_map = {}
        for mapping in assembly_mappings:
            machining_name = mapping.machining_item.name
            assembly_name = mapping.assembly_item.name
            assembly_line_id = mapping.assembly_item.line_id
            if machining_name not in machining_to_assembly_map:
                machining_to_assembly_map[machining_name] = []
            machining_to_assembly_map[machining_name].append((assembly_name, assembly_line_id))

        # 組付生産計画データを取得（1回のクエリで全て取得）
        assembly_items_info = [(name, line_id) for items in machining_to_assembly_map.values() for name, line_id in items]
        assembly_item_names = [name for name, _ in assembly_items_info]

        assembly_plans = DailyAssenblyProductionPlan.objects.filter(
            date__gte=date_list[0],
            date__lte=date_list[-1],
            production_item__name__in=assembly_item_names
        ).select_related('production_item', 'line')

        # 組付生産計画をマップ化: {(date, shift, assembly_line_id, assembly_item_name): plan}
        assembly_plans_map = {
            (plan.date, plan.shift, plan.line_id, plan.production_item.name): plan
            for plan in assembly_plans
            if plan.production_item and plan.shift and plan.line_id
        }

        # 既存の加工ラインの出庫数を取得（1回のクエリで全て取得）
        all_machining_line_ids = [line.id for line in lines_by_assembly.values()]
        all_machining_plans = DailyMachiningProductionPlan.objects.filter(
            line_id__in=all_machining_line_ids,
            date__gte=date_list[0],
            date__lte=date_list[-1]
        ).select_related('production_item', 'line__assembly')

        # 加工ラインの計画をマップ化: {(assembly_name, date, shift, item_name): plan}
        machining_plans_map = {
            (plan.line.assembly.name if plan.line.assembly else None, plan.date, plan.shift, plan.production_item.name): plan
            for plan in all_machining_plans
            if plan.production_item and plan.shift and plan.line and plan.line.assembly
        }

        # 組立ラインIDから名前へのマップを作成（ループ内でのORMクエリを避けるため）
        assembly_line_id_to_name = {
            line.id: line.name
            for line in AssemblyLine.objects.filter(id__in=[line_id for items in machining_to_assembly_map.values() for _, line_id in items])
        }

        # 日付ベースのデータ構造を構築
        dates_data = []
        for date_obj in date_list:
            date_info = {
                'date': date_obj,
                'day': date_obj.day,
                'weekday': date_obj.weekday(),
                'is_weekend': date_obj.weekday() >= 5,
                'items': {},
                'occupancy_rates': {},  # {assembly_name: occupancy_rate}
                'shifts': {
                    'day': {},
                    'night': {}
                }
            }

            # 品番ごとのデータ
            for item_name in item_names:
                # 組付からの出庫数を初期化
                total_shipment = {'day': 0, 'night': 0}
                assembly_shipment_by_line = {}  # {assembly_name: {'day': value, 'night': value}}
                shipment_by_line = {}  # {assembly_name: {'day': value, 'night': value}}

                # 各組立ラインごとに初期化
                for assembly_name in lines_by_assembly.keys():
                    assembly_shipment_by_line[assembly_name] = {'day': 0, 'night': 0}
                    shipment_by_line[assembly_name] = {'day': 0, 'night': 0}

                # 日勤と夜勤を統一的に処理
                for shift in ['day', 'night']:
                    # 組付生産計画から出庫数を計算
                    assembly_items = machining_to_assembly_map.get(item_name, [])
                    for assembly_item_name, assembly_line_id in assembly_items:
                        # 組立ラインの名前を取得（マップから）
                        corresponding_assembly_line = assembly_line_id_to_name.get(assembly_line_id)

                        key = (date_obj, shift, assembly_line_id, assembly_item_name)
                        if key in assembly_plans_map:
                            assembly_plan = assembly_plans_map[key]
                            qty = assembly_plan.production_quantity or 0
                            total_shipment[shift] += qty
                            if corresponding_assembly_line and corresponding_assembly_line in assembly_shipment_by_line:
                                assembly_shipment_by_line[corresponding_assembly_line][shift] += qty

                    # 既存の加工ラインの出庫数（マップから取得）
                    for assembly_name in lines_by_assembly.keys():
                        key = (assembly_name, date_obj, shift, item_name)
                        plan = machining_plans_map.get(key)
                        shipment = plan.shipment if plan and plan.shipment is not None else 0
                        shipment_by_line[assembly_name][shift] = shipment

                        # 稼働率の取得（最初の品番でのみ設定）
                        if assembly_name not in date_info['occupancy_rates'] and plan:
                            if plan.occupancy_rate is not None:
                                date_info['occupancy_rates'][assembly_name] = plan.occupancy_rate * 100

                # 稼働率のデフォルト値設定
                for assembly_name in lines_by_assembly.keys():
                    if assembly_name not in date_info['occupancy_rates']:
                        line = lines_by_assembly.get(assembly_name)
                        if line and line.occupancy_rate:
                            date_info['occupancy_rates'][assembly_name] = line.occupancy_rate * 100
                        else:
                            date_info['occupancy_rates'][assembly_name] = ''

                # データを構築
                item_data = {
                    'total_shipment_day': total_shipment['day'],
                    'total_shipment_night': total_shipment['night'],
                    'line_info': item_line_info.get(item_name, 'both'),
                    'shipment_by_line': shipment_by_line,
                    'assembly_shipment_by_line': assembly_shipment_by_line
                }

                date_info['items'][item_name] = item_data

            dates_data.append(date_info)

        # 前月の最終直の在庫数を取得（計算の起点として使用）
        import calendar
        from datetime import timedelta

        prev_month_year = year if month > 1 else year - 1
        prev_month = month - 1 if month > 1 else 12
        prev_month_last_day = calendar.monthrange(prev_month_year, prev_month)[1]

        # 前月の最終直のデータを取得（土日を考慮して実際にデータがある日を探す）
        prev_month_stock_map = {}  # {item_name: stock}

        # 前月末から遡ってデータを探す（最大10日遡る）
        # MachiningStockテーブルから前月の最終直の在庫を取得
        for days_back in range(10):
            check_date = date(prev_month_year, prev_month, prev_month_last_day) - timedelta(days=days_back)

            # 夜勤から先にチェック
            for check_shift in ['night', 'day']:
                # MachiningStockから在庫データを取得
                prev_stocks = MachiningStock.objects.filter(
                    line_name=line_type,
                    date=check_date,
                    shift=check_shift
                )

                if prev_stocks.exists():
                    # データが見つかったら在庫を取得
                    for stock in prev_stocks:
                        if stock.item_name not in prev_month_stock_map:
                            prev_month_stock_map[stock.item_name] = stock.stock or 0
                    break

            if prev_month_stock_map:
                break

        # 在庫数を計算（前の直の在庫 + 全ラインの生産数 - 全ラインの出庫数）
        stock_by_item_shift = {}  # {(item_name, date_index, shift): stock}

        for date_index, date_info in enumerate(dates_data):
            for item_name in item_names:
                item_data = date_info['items'][item_name]

                for shift in ['day', 'night']:
                    # 前の直の在庫を取得
                    if shift == 'day' and date_index == 0:
                        # 月初の日勤：前月最終直の在庫を使用
                        prev_stock = prev_month_stock_map.get(item_name, 0)
                        # 前の直の生産数・出庫数（前月データなのでここでは計算に含めない）
                        total_production = 0
                        total_shipment = 0
                    elif shift == 'day':
                        # 日勤：前日夜勤の在庫
                        prev_stock = stock_by_item_shift.get((item_name, date_index - 1, 'night'), 0)
                        # 前日夜勤の生産数・出庫数
                        prev_date = dates_data[date_index - 1]['date']
                        total_production = 0
                        total_shipment = 0
                        for asm_name in lines_by_assembly.keys():
                            key = (asm_name, prev_date, 'night', item_name)
                            prev_plan = machining_plans_map.get(key)
                            if prev_plan:
                                total_production += prev_plan.production_quantity or 0
                                total_shipment += prev_plan.shipment or 0
                    else:
                        # 夜勤：同日日勤の在庫
                        prev_stock = stock_by_item_shift.get((item_name, date_index, 'day'), 0)
                        # 同日日勤の生産数・出庫数
                        current_date = date_info['date']
                        total_production = 0
                        total_shipment = 0
                        for asm_name in lines_by_assembly.keys():
                            key = (asm_name, current_date, 'day', item_name)
                            prev_plan = machining_plans_map.get(key)
                            if prev_plan:
                                total_production += prev_plan.production_quantity or 0
                                total_shipment += prev_plan.shipment or 0

                    # 在庫数を計算: 前の直の在庫 + 生産数 - 出庫数
                    calculated_stock = prev_stock + total_production - total_shipment
                    calculated_stock = max(0, calculated_stock)  # マイナスにならないように

                    # 在庫を記録（次の直で使用）
                    stock_by_item_shift[(item_name, date_index, shift)] = calculated_stock

                    # 各組み付けラインに同じ在庫数を設定
                    for assembly_name in lines_by_assembly.keys():
                        stock_key = f'stock_{assembly_name.replace("#", "")}_{shift}'
                        item_data[stock_key] = calculated_stock

        # タクト情報（動的に対応）
        tacts = {}
        for assembly_name, line in lines_by_assembly.items():
            tacts[assembly_name] = line.tact if line.tact else 0

        # 組付ラインのリストを取得（順序付き）
        assembly_line_names = sorted(lines_by_assembly.keys())

        # 各ラインの品番リストを作成（そのラインで作成できる品番のみ）
        items_by_assembly = {}
        for assembly_name in assembly_line_names:
            items_by_assembly[assembly_name] = sorted([
                item_name for item_name in item_names
                if item_name in items_by_line.get(assembly_name, set())
            ])

        # テンプレート用のライン情報リストを作成
        assembly_lines_data = []
        for assembly_name in assembly_line_names:
            items = items_by_assembly.get(assembly_name, [])
            assembly_lines_data.append({
                'name': assembly_name,
                'display_name': f'{assembly_name}ライン出庫数',
                'items': items,
                'items_count': len(items),
                'shift_rowspan': len(items) + 1,  # 品番数 + 残業時間行
                'category_rowspan': (len(items) + 1) * 2,  # (品番数 + 残業時間行) × 2 (日勤・夜勤)
                'line': lines_by_assembly.get(assembly_name),
                'tact': tacts.get(assembly_name, 0),
                'css_class': f'line-{assembly_name.replace("#", "")}-shipment-input',
                'data_section': f'line_{assembly_name.replace("#", "")}_shipment',
            })

        # dates_dataをJSON化可能な形式に変換（occupancy_ratesのみを抽出）
        dates_data_json = []
        for date_info in dates_data:
            dates_data_json.append({
                'occupancy_rates': date_info['occupancy_rates']
            })

        # 既存データがあるかチェック
        has_existing_data = DailyMachiningProductionPlan.objects.filter(
            date__year=year,
            date__month=month,
            line__name=line_type
        ).exists()

        context = {
            'year': year,
            'month': month,
            'line_type': line_type,
            'line_types': line_types,
            'assembly_lines_data': assembly_lines_data,
            'item_names': item_names,
            'dates_data': dates_data,
            'dates_data_json': json.dumps(dates_data_json),
            'item_line_info': json.dumps(item_line_info),
            'item_main_line': json.dumps(item_main_line),
            'tacts_json': json.dumps(tacts),
            'has_existing_data': has_existing_data,
            'lines_by_assembly': lines_by_assembly,
            'assembly_line_names': assembly_line_names,
            'items_by_assembly': items_by_assembly,
            'tacts': tacts,
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """保存処理"""
        try:
            data = json.loads(request.body)
            result = self._save_shipment(data, request)
            return JsonResponse(result)

        except Exception as e:
            return JsonResponse({'success': False, 'message': str(e)}, status=500)

    # ========================================
    # ヘルパーメソッド - 計算
    # ========================================
    def _calculate_overtime(self, production_quantity, tact, occupancy_rate):
        """残業時間を計算（5分刻み）"""
        required_time = tact * production_quantity
        available_time = REGULAR_TIME_MINUTES * occupancy_rate
        overtime_minutes = max(0, required_time - available_time)

        # 5分刻みに切り上げ
        return int((overtime_minutes + OVERTIME_ROUND_MINUTES - 1) // OVERTIME_ROUND_MINUTES * OVERTIME_ROUND_MINUTES)

    def _save_shipment(self, data, request):
        """出庫数を保存"""
        try:
            line_type = data.get('line_type')
            year = data.get('year')
            month = data.get('month')
            dates_data = data.get('dates', [])

            # 加工ラインを動的に取得
            machining_lines = MachiningLine.objects.filter(
                name=line_type,
                active=True
            ).select_related('assembly')

            lines_by_assembly = {}
            for line in machining_lines:
                if line.assembly:
                    lines_by_assembly[line.assembly.name] = line

            if not lines_by_assembly:
                return {'success': False, 'message': '対象の加工ラインが見つかりません'}

            # 対象月の日付リストを作成
            date_list = days_in_month_dates(year, month)

            # 全ての品番を事前に取得してマップ化（N+1問題を回避）
            all_line_ids = [line.id for line in lines_by_assembly.values()]
            all_items = MachiningItem.objects.filter(
                line_id__in=all_line_ids,
                active=True
            ).select_related('line')

            # マップ化: {(line_id, item_name): MachiningItem}
            items_map = {
                (item.line_id, item.name): item
                for item in all_items
            }

            # ユーザー名を取得
            username = request.user.username if request and hasattr(request, 'user') else 'system'

            # 既存データを一括取得
            existing_plans_list = DailyMachiningProductionPlan.objects.filter(
                line_id__in=all_line_ids,
                date__in=date_list
            ).select_related('production_item', 'line')

            # 既存データをマップ化: {(line_id, date, shift, item_id): plan}
            existing_plans = {
                (plan.line_id, plan.date, plan.shift, plan.production_item_id): plan
                for plan in existing_plans_list
            }

            # 保存するデータをリストに集める
            plans_to_update = []
            plans_to_create = []

            # 保存処理
            for date_data in dates_data:
                date_index = date_data.get('date_index')
                if date_index >= len(date_list):
                    continue

                date = date_list[date_index]
                items = date_data.get('items', {})
                overtime_data = date_data.get('overtime', {})  # フロントエンドから送られてきた残業時間

                for item_name, shift_data in items.items():
                    for shift, line_values in shift_data.items():
                        # 各組付ラインごとに保存（動的に対応）
                        for assembly_name, line in lines_by_assembly.items():
                            # line_1, line_2の形式で送られてくるデータに対応
                            # assembly_name が '#1' なら 'line_1', '#2' なら 'line_2'
                            line_key = f'line_{assembly_name.replace("#", "")}'
                            line_value = line_values.get(line_key, 0)

                            # このラインの出庫数が0の場合はスキップ（データを保存しない）
                            if line_value == 0:
                                continue

                            # マップから品番を取得
                            item_obj = items_map.get((line.id, item_name))
                            if not item_obj:
                                # 該当品番がこのラインで作れない場合はスキップ
                                continue

                            # 稼働率を取得
                            occupancy_rate = line.occupancy_rate if line.occupancy_rate else 1.0

                            # フロントエンドで計算された残業時間を取得（対象日の対象の直の合計）
                            overtime_minutes = overtime_data.get(assembly_name, {}).get(shift, 0)

                            # 既存データのキー
                            key = (line.id, date, shift, item_obj.id)
                            existing_plan = existing_plans.get(key)

                            if existing_plan:
                                # 更新
                                existing_plan.shipment = line_value
                                existing_plan.production_quantity = line_value
                                existing_plan.overtime = overtime_minutes
                                existing_plan.occupancy_rate = occupancy_rate
                                existing_plan.regular_working_hours = False
                                existing_plan.last_updated_user = username
                                plans_to_update.append(existing_plan)
                            else:
                                # 新規作成
                                plans_to_create.append(DailyMachiningProductionPlan(
                                    line=line,
                                    production_item=item_obj,
                                    date=date,
                                    shift=shift,
                                    shipment=line_value,
                                    production_quantity=line_value,
                                    overtime=overtime_minutes,
                                    occupancy_rate=occupancy_rate,
                                    regular_working_hours=False,
                                    last_updated_user=username
                                ))

            # 一括更新・作成
            if plans_to_update:
                DailyMachiningProductionPlan.objects.bulk_update(
                    plans_to_update,
                    ['shipment', 'production_quantity', 'overtime', 'occupancy_rate', 'regular_working_hours', 'last_updated_user']
                )

            if plans_to_create:
                DailyMachiningProductionPlan.objects.bulk_create(plans_to_create)

            # メッセージ作成
            message_parts = []
            if len(plans_to_update) > 0:
                message_parts.append(f'更新: {len(plans_to_update)}件')
            if len(plans_to_create) > 0:
                message_parts.append(f'新規: {len(plans_to_create)}件')

            message = '保存しました'

            return {'success': True, 'message': message}

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'success': False, 'message': f'保存中にエラーが発生しました: {str(e)}'}
