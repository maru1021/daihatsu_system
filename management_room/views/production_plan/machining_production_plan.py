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
            line = MachiningLine.objects.filter(active=True).first()

        # 品番を取得（このラインの品番）
        items = MachiningItem.objects.filter(line=line, active=True).values('name').distinct()
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
                        production_qty = plan.production_quantity if plan.production_quantity is not None else 0
                        # 品番データ（データベースに保存されている値をそのまま使用）
                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': production_qty,
                            'shipment': plan.shipment if plan.shipment is not None else 0
                        }
                        # DailyMachiningProductionPlanにレコードが存在すれば休出として扱う
                        date_info['has_data'] = True

                        # 最初に見つかったプラン（共通データ用、dayまたはnightで最初の1つのみ）
                        if first_plan_for_common is None:
                            first_plan_for_common = plan

                        # シフトごとの最初のプラン（stop_time/overtime用）
                        if first_plan_for_shift is None:
                            first_plan_for_shift = plan
                    else:
                        # データがない場合はNone
                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': None,
                            'shipment': None
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

        # 在庫データを取得（MachiningStockから）
        stock_records = MachiningStock.objects.filter(
            line_name=line.name,
            date__gte=date_list[0],
            date__lte=date_list[-1],
            item_name__in=item_names
        )

        # 在庫データをマップ化: {(date, shift, item_name): stock}
        stock_map = {
            (stock.date, stock.shift, stock.item_name): stock.stock
            for stock in stock_records
            if stock.date and stock.shift and stock.item_name
        }

        # 在庫データを日付データに反映
        for date_info in dates_data:
            date = date_info['date']
            for shift in ['day', 'night']:
                for item_name in item_names:
                    stock_key = (date, shift, item_name)
                    stock_value = stock_map.get(stock_key, None)
                    if item_name in date_info['shifts'][shift]['items']:
                        date_info['shifts'][shift]['items'][item_name]['stock'] = stock_value
                    else:
                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': None,
                            'shipment': None,
                            'stock': stock_value
                        }

        # 組付側の休出日をチェック（出庫数入力のため）
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

        # 組付生産計画データを取得（休出チェック用のみ）
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

        # 組付側の休出チェック（週末に出庫数入力のみ表示するため）
        for date_info in dates_data:
            date = date_info['date']

            # 組付側の生産数が0より大きい場合のみ休出と判定
            has_assembly_weekend_work = False
            for shift in ['day', 'night']:
                for item_name in item_names:
                    assembly_items = machining_to_assembly_map.get(item_name, [])
                    for assembly_item_name, assembly_line_id in assembly_items:
                        key = (date, shift, assembly_line_id, assembly_item_name)
                        if key in assembly_plans_map:
                            assembly_plan = assembly_plans_map[key]
                            # 週末かつ組付側の生産数が1以上の場合
                            if date_info['is_weekend'] and assembly_plan.production_quantity and assembly_plan.production_quantity > 0:
                                has_assembly_weekend_work = True
                                break
                    if has_assembly_weekend_work:
                        break
                if has_assembly_weekend_work:
                    break

            # 組付側の休出フラグを保存
            date_info['has_assembly_weekend_work'] = has_assembly_weekend_work

        # タクトはライン単位（品番ごとではない）
        item_data = {
            'tact': line.tact if line.tact else 0
        }

        # 前月末の在庫を取得
        from datetime import date
        from dateutil.relativedelta import relativedelta

        # 前月の最終日を計算
        first_day_of_month = date(year, month, 1)
        last_day_of_previous_month = first_day_of_month - relativedelta(days=1)

        # 前月末の在庫データを取得（品番ごと）
        previous_month_stocks = {}
        for item_name in item_names:
            # 前月の最終稼働日の在庫を取得（日付降順で最初のレコード）
            # 夜勤を優先して検索
            last_stock = MachiningStock.objects.filter(
                line_name=line.name,
                item_name=item_name,
                date__lt=first_day_of_month  # 当月より前
            ).order_by('-date', '-shift').first()  # 日付降順、shift降順（night > day）

            if last_stock and last_stock.stock is not None:
                previous_month_stocks[item_name] = last_stock.stock
            else:
                previous_month_stocks[item_name] = 0

        lines = MachiningLine.objects.select_related('assembly').filter(active=True).order_by('assembly__order', 'order')
        lines_list = [{'id': l.id, 'name': l.name, 'assembly_name': l.assembly.name if l.assembly else None} for l in lines]

        # 生産数セクションの行数を計算
        production_total_rows = len(item_names) * 2  # 日勤 + 夜勤

        # 月末在庫と適正在庫を比較
        inventory_comparison = []
        for item_name in item_names:
            # 加工品番の適正在庫を取得
            machining_item = MachiningItem.objects.filter(
                line=line,
                name=item_name,
                active=True
            ).first()

            optimal_inventory = machining_item.optimal_inventory if machining_item and machining_item.optimal_inventory is not None else 0

            # 月末在庫を取得（月の最終日の最後のシフトの在庫）
            last_day_of_month = date_list[-1]
            end_of_month_stock_record = MachiningStock.objects.filter(
                line_name=line.name,
                item_name=item_name,
                date=last_day_of_month
            ).order_by('-shift').first()  # night > day

            end_of_month_stock = end_of_month_stock_record.stock if end_of_month_stock_record and end_of_month_stock_record.stock is not None else 0

            # 差分を計算（月末在庫 - 適正在庫）
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
            'line': line,
            'dates_data': dates_data,
            'item_names': item_names,
            'lines': lines_list,
            'production_total_rows': production_total_rows,
            'item_data_json': json.dumps(item_data),
            'previous_month_stocks_json': json.dumps(previous_month_stocks),
            'inventory_comparison': inventory_comparison,
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """加工生産計画データを保存"""
        try:
            # JSONデータを取得
            data = json.loads(request.body)
            dates_data = data.get('dates_data', [])
            dates_to_delete = data.get('dates_to_delete', [])

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

            # 削除対象の日付のデータを削除
            deleted_count = 0
            if dates_to_delete:
                delete_dates = [dates[idx] for idx in dates_to_delete if idx < len(dates)]
                deleted_count = DailyMachiningProductionPlan.objects.filter(
                    line=line,
                    date__in=delete_dates
                ).delete()[0]

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
                        shipment = item_data.get('shipment', 0) if isinstance(item_data, dict) else 0

                        # 既存データのキー
                        key = (date_obj, shift_name, item_pk)
                        existing_plan = existing_plans.get(key)

                        if existing_plan:
                            # 更新
                            existing_plan.production_quantity = production_quantity
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
                    ['production_quantity', 'shipment', 'stop_time', 'overtime', 'occupancy_rate', 'regular_working_hours', 'last_updated_user']
                )

            if plans_to_create:
                DailyMachiningProductionPlan.objects.bulk_create(plans_to_create)

            # 在庫データを保存（MachiningStock）
            # 既存の在庫データを取得
            existing_stocks_list = MachiningStock.objects.filter(
                line_name=line.name,
                date__in=dates,
                item_name__in=item_dict.keys()
            )

            # 複合キーで辞書化
            existing_stocks = {
                (stock.date, stock.shift, stock.item_name): stock
                for stock in existing_stocks_list
            }

            stocks_to_update = []
            stocks_to_create = []

            # 日付ベースで在庫データを処理
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

                        # 在庫データを取得
                        stock_value = item_data.get('stock') if isinstance(item_data, dict) else None

                        # stock_valueがNoneの場合はスキップ
                        if stock_value is None:
                            continue

                        # 既存データのキー
                        key = (date_obj, shift_name, item_name)
                        existing_stock = existing_stocks.get(key)

                        if existing_stock:
                            # 更新
                            existing_stock.stock = stock_value
                            existing_stock.last_updated_user = username
                            stocks_to_update.append(existing_stock)
                        else:
                            # 新規作成
                            stocks_to_create.append(MachiningStock(
                                line_name=line.name,
                                item_name=item_name,
                                date=date_obj,
                                shift=shift_name,
                                stock=stock_value,
                                last_updated_user=username
                            ))

            # 在庫データの一括更新・作成
            stock_updated_count = 0
            stock_created_count = 0
            if stocks_to_update:
                MachiningStock.objects.bulk_update(
                    stocks_to_update,
                    ['stock', 'last_updated_user']
                )
                stock_updated_count = len(stocks_to_update)

            if stocks_to_create:
                MachiningStock.objects.bulk_create(stocks_to_create)
                stock_created_count = len(stocks_to_create)

            message_parts = []
            if deleted_count > 0:
                message_parts.append(f'削除: {deleted_count}件')
            if len(plans_to_update) > 0:
                message_parts.append(f'更新: {len(plans_to_update)}件')
            if len(plans_to_create) > 0:
                message_parts.append(f'新規: {len(plans_to_create)}件')
            if stock_updated_count > 0:
                message_parts.append(f'在庫更新: {stock_updated_count}件')
            if stock_created_count > 0:
                message_parts.append(f'在庫新規: {stock_created_count}件')

            message = '保存しました（' + '、'.join(message_parts) + '）' if message_parts else '保存しました'

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
