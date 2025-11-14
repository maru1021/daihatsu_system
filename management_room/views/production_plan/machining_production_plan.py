from management_room.models import DailyMachiningProductionPlan, MachiningItem, AssemblyItemMachiningItemMap, DailyAssenblyProductionPlan
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

    def get(self, request, *args, **kwargs):
        if request.GET.get('year') and request.GET.get('month'):
            year = int(request.GET.get('year'))
            month = int(request.GET.get('month'))
        else:
            year = datetime.now().year
            month = datetime.now().month

        # 対象月の日付リストを作成
        date_list = days_in_month_dates(year, month)

        # 加工ラインを取得
        if request.GET.get('line'):
            line = MachiningLine.objects.get(id=request.GET.get('line'))
        else:
            line = MachiningLine.objects.filter(active=True).order_by('name').first()

        # 品番を取得（このラインの品番）
        items = MachiningItem.objects.filter(line=line, active=True).values('name').distinct().order_by('name')
        item_names = [item['name'] for item in items]

        # 全データを1回のクエリで取得
        plans = DailyMachiningProductionPlan.objects.filter(
            line=line,
            date__gte=date_list[0],
            date__lte=date_list[-1]
        ).select_related('production_item').order_by('date', 'shift', 'production_item')

        # ラインのデフォルト稼働率を取得（パーセント表示用に100倍）
        default_occupancy_rate = (line.occupancy_rate * 100) if line.occupancy_rate else ''

        # plansをグループ化: {(date, shift, item_name): plan}
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
                    'day': {'items': {}, 'stop_time': 0, 'overtime': 0},
                    'night': {'items': {}, 'stop_time': 0, 'overtime': 0}
                }
            }

            # 共通データ取得用（最初に見つかったプラン）
            first_plan_for_common = None

            # 日勤と夜勤それぞれ処理
            for shift in ['day', 'night']:
                first_plan_for_shift = None
                for item_name in item_names:
                    key = (date, shift, item_name)
                    if key in plans_map:
                        plan = plans_map[key]
                        # 品番データ（生産数、在庫数、出庫数を含む）
                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': plan.production_quantity or 0,
                            'stock': plan.stock or 0,
                            'shipment': plan.shipment or 0
                        }
                        # データがあることを記録
                        date_info['has_data'] = True

                        # 最初に見つかったプラン（共通データ用、dayまたはnightで最初の1つのみ）
                        if first_plan_for_common is None:
                            first_plan_for_common = plan

                        # シフトごとの最初のプラン（stop_time/overtime用）
                        if first_plan_for_shift is None:
                            first_plan_for_shift = plan
                    else:
                        # データがない場合
                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': 0,
                            'stock': 0,
                            'shipment': 0
                        }

                # シフトごとのデータ（stop_time、overtime）
                if first_plan_for_shift:
                    date_info['shifts'][shift]['stop_time'] = first_plan_for_shift.stop_time or 0
                    date_info['shifts'][shift]['overtime'] = first_plan_for_shift.overtime or 0

            # 共通データ（occupancy_rate、regular_working_hours）
            if first_plan_for_common:
                if first_plan_for_common.occupancy_rate is not None:
                    date_info['occupancy_rate'] = first_plan_for_common.occupancy_rate * 100
                date_info['regular_working_hours'] = first_plan_for_common.regular_working_hours

            dates_data.append(date_info)

        # 出庫数を計算（AssemblyItemMachiningItemMapを使用）
        # 加工品番ごとに紐づいた完成品番を取得
        machining_items_obj = MachiningItem.objects.filter(line=line, active=True, name__in=item_names)
        assembly_mappings = AssemblyItemMachiningItemMap.objects.filter(
            machining_item__in=machining_items_obj,
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

        # 組付生産計画データを取得
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

        # 出庫数を計算して日付データに反映
        # 組付側の休出日も記録
        for date_info in dates_data:
            date = date_info['date']

            # 組付側に休出があるかチェック
            has_assembly_weekend_work = False
            for shift in ['day', 'night']:
                for item_name in item_names:
                    assembly_items = machining_to_assembly_map.get(item_name, [])
                    for assembly_item_name, assembly_line_id in assembly_items:
                        key = (date, shift, assembly_line_id, assembly_item_name)
                        if key in assembly_plans_map:
                            # 組付側でデータがある = 休出がある
                            if date_info['is_weekend']:
                                has_assembly_weekend_work = True
                                break
                    if has_assembly_weekend_work:
                        break
                if has_assembly_weekend_work:
                    break

            # 組付側の休出フラグを保存
            date_info['has_assembly_weekend_work'] = has_assembly_weekend_work

            for shift in ['day', 'night']:
                for item_name in item_names:
                    # この加工品番に紐づく完成品番を取得（ラインIDも含む）
                    assembly_items = machining_to_assembly_map.get(item_name, [])

                    # 紐づいた完成品番の生産数を合計
                    total_shipment = 0
                    for assembly_item_name, assembly_line_id in assembly_items:
                        key = (date, shift, assembly_line_id, assembly_item_name)
                        if key in assembly_plans_map:
                            assembly_plan = assembly_plans_map[key]
                            total_shipment += assembly_plan.production_quantity or 0

                    # 出庫数を上書き
                    if item_name in date_info['shifts'][shift]['items']:
                        date_info['shifts'][shift]['items'][item_name]['shipment'] = total_shipment

        # タクトはライン単位（品番ごとではない）
        item_data = {
            'tact': line.tact if line.tact else 0
        }

        lines = MachiningLine.objects.filter(active=True).order_by('name')
        lines_list = [{'id': l.id, 'name': l.name} for l in lines]

        # 生産数セクションの行数を計算
        production_total_rows = len(item_names) * 2  # 日勤 + 夜勤

        context = {
            'year': year,
            'month': month,
            'line': line,
            'dates_data': dates_data,
            'item_names': item_names,
            'lines': lines_list,
            'production_total_rows': production_total_rows,
            'item_data_json': json.dumps(item_data),
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """加工生産計画データを保存"""
        try:
            # JSONデータを取得
            data = json.loads(request.body)
            dates_data = data.get('dates_data', [])

            # 対象期間を取得
            if request.GET.get('year') and request.GET.get('month'):
                year = int(request.GET.get('year'))
                month = int(request.GET.get('month'))
            else:
                year = datetime.now().year
                month = datetime.now().month

            # ラインを取得
            if request.GET.get('line'):
                line = MachiningLine.objects.get(id=request.GET.get('line'))
            else:
                line = MachiningLine.objects.filter(active=True).order_by('name').first()

            # 日付リストを生成
            dates = days_in_month_dates(year, month)

            # 品番リストを取得
            items = MachiningItem.objects.filter(line=line, active=True).values_list('pk', 'name')
            item_dict = {item_name: item_pk for item_pk, item_name in items}

            # ユーザー名を取得
            username = request.user.username if request.user.is_authenticated else 'system'

            # 既存データを取得（一括取得）
            existing_plans_list = DailyMachiningProductionPlan.objects.filter(
                line=line,
                date__in=dates
            ).select_related('production_item')

            # 複合キーで辞書化
            existing_plans = {
                (plan.date, plan.shift, plan.production_item_id): plan
                for plan in existing_plans_list
            }

            # 保存するデータをリストに集める
            plans_to_update = []
            plans_to_create = []

            # 日付ベースでデータを処理
            for date_info in dates_data:
                date_index = date_info.get('date_index')
                if date_index >= len(dates):
                    continue

                date_obj = dates[date_index]
                occupancy_rate = date_info.get('occupancy_rate')
                regular_working_hours = date_info.get('regular_working_hours', False)
                shifts = date_info.get('shifts', {})

                # 日勤と夜勤を処理
                for shift_name, shift_data in shifts.items():
                    stop_time = shift_data.get('stop_time', 0)
                    overtime = shift_data.get('overtime', 0)
                    items_data = shift_data.get('items', {})

                    # 品番ごとにデータを準備
                    for item_name, item_data in items_data.items():
                        item_pk = item_dict.get(item_name)
                        if not item_pk:
                            continue

                        production_quantity = item_data.get('production_quantity', 0) if isinstance(item_data, dict) else item_data
                        stock = item_data.get('stock', 0) if isinstance(item_data, dict) else 0
                        shipment = item_data.get('shipment', 0) if isinstance(item_data, dict) else 0

                        # 既存データのキー
                        key = (date_obj, shift_name, item_pk)
                        existing_plan = existing_plans.get(key)

                        if existing_plan:
                            # 更新
                            existing_plan.production_quantity = production_quantity
                            existing_plan.stock = stock
                            existing_plan.shipment = shipment
                            existing_plan.stop_time = stop_time
                            existing_plan.overtime = overtime
                            existing_plan.occupancy_rate = (occupancy_rate / 100) if occupancy_rate is not None else None
                            existing_plan.regular_working_hours = regular_working_hours
                            existing_plan.last_updated_user = username
                            plans_to_update.append(existing_plan)
                        else:
                            # 新規作成
                            plans_to_create.append(DailyMachiningProductionPlan(
                                line=line,
                                production_item_id=item_pk,
                                date=date_obj,
                                shift=shift_name,
                                production_quantity=production_quantity,
                                stock=stock,
                                shipment=shipment,
                                stop_time=stop_time,
                                overtime=overtime,
                                occupancy_rate=(occupancy_rate / 100) if occupancy_rate is not None else None,
                                regular_working_hours=regular_working_hours,
                                last_updated_user=username
                            ))

            # 一括更新・作成
            if plans_to_update:
                DailyMachiningProductionPlan.objects.bulk_update(
                    plans_to_update,
                    ['production_quantity', 'stock', 'shipment', 'stop_time', 'overtime', 'occupancy_rate', 'regular_working_hours', 'last_updated_user']
                )

            if plans_to_create:
                DailyMachiningProductionPlan.objects.bulk_create(plans_to_create)

            return JsonResponse({
                'status': 'success',
                'message': f'保存しました（更新: {len(plans_to_update)}件、新規: {len(plans_to_create)}件）'
            })

        except Exception as e:
            import traceback
            return JsonResponse({
                'status': 'error',
                'message': str(e),
                'traceback': traceback.format_exc()
            }, status=400)
