from management_room.models import DailyAssenblyProductionPlan, AssemblyItem, MonthlyAssemblyProductionPlan
from manufacturing.models import AssemblyLine
from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render
from django.http import JsonResponse
from datetime import datetime
import json
from utils.days_in_month_dates import days_in_month_dates


class AssemblyProductionPlanView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/assembly_production_plan.html'

    def get(self, request, *args, **kwargs):
        if request.GET.get('year') and request.GET.get('month'):
            year = int(request.GET.get('year'))
            month = int(request.GET.get('month'))
        else:
            year = datetime.now().year
            month = datetime.now().month

        # 対象月の日付リストを作成
        date_list = days_in_month_dates(year, month)

        # 組付ラインを取得
        if request.GET.get('line'):
            line = AssemblyLine.objects.get(id=request.GET.get('line'))
        else:
            line = AssemblyLine.objects.filter(active=True).order_by('name').first()

        # 品番を取得（このラインの完成品番）
        items = AssemblyItem.objects.filter(line=line, active=True).values('name').distinct().order_by('name')
        item_names = [item['name'] for item in items]

        # 全データを1回のクエリで取得
        plans = DailyAssenblyProductionPlan.objects.filter(
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
                        # 品番データ（データベースに保存されている値をそのまま使用）
                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': plan.production_quantity if plan.production_quantity is not None else 0
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
                        # データがない場合はNone
                        date_info['shifts'][shift]['items'][item_name] = {
                            'production_quantity': None
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

        # タクトはライン単位（品番ごとではない）
        item_data = {
            'tact': line.tact if line.tact else 0
        }

        lines = AssemblyLine.objects.filter(active=True).order_by('name')
        lines_list = [{'id': l.id, 'name': l.name} for l in lines]

        # 生産数セクションの行数を計算
        production_total_rows = len(item_names) * 2  # 日勤 + 夜勤

        # 月別生産計画データを取得
        month_date = datetime(year, month, 1).date()
        monthly_plans = MonthlyAssemblyProductionPlan.objects.filter(
            line=line,
            month=month_date
        ).select_related('production_item').order_by('production_item__name')

        monthly_plans_data = []
        monthly_total = 0
        monthly_plan_quantities = {}  # {item_name: quantity}

        for plan in monthly_plans:
            if plan.production_item:
                quantity = plan.quantity if plan.quantity else 0
                monthly_plans_data.append({
                    'item_name': plan.production_item.name,
                    'quantity': quantity
                })
                monthly_total += quantity
                monthly_plan_quantities[plan.production_item.name] = quantity

        # 月別計画の品番ごとの割合を計算（四捨五入）
        monthly_plan_ratios = {}
        if monthly_total > 0:
            for item_name, quantity in monthly_plan_quantities.items():
                ratio = quantity / monthly_total
                # 四捨五入して小数点以下4桁まで保持
                monthly_plan_ratios[item_name] = round(ratio, 4)
        # DailyAssenblyProductionPlan.objects.all().delete()

        context = {
            'year': year,
            'month': month,
            'line': line,
            'dates_data': dates_data,
            'item_names': item_names,
            'lines': lines_list,
            'production_total_rows': production_total_rows,
            'item_data_json': json.dumps(item_data),
            'monthly_plans': monthly_plans_data,
            'monthly_plan_ratios': json.dumps(monthly_plan_ratios),
            'monthly_plan_quantities': json.dumps(monthly_plan_quantities),
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """組付生産計画データを保存"""
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
                line = AssemblyLine.objects.get(id=request.GET.get('line'))
            else:
                line = AssemblyLine.objects.filter(active=True).order_by('name').first()

            # 日付リストを生成
            dates = days_in_month_dates(year, month)

            # 品番リストを取得
            items = AssemblyItem.objects.filter(line=line, active=True).values_list('pk', 'name')
            item_dict = {item_name: item_pk for item_pk, item_name in items}

            # ユーザー名を取得
            username = request.user.username if request.user.is_authenticated else 'system'

            # 削除対象の日付のデータを削除
            deleted_count = 0
            if dates_to_delete:
                delete_dates = [dates[idx] for idx in dates_to_delete if idx < len(dates)]
                deleted_count = DailyAssenblyProductionPlan.objects.filter(
                    line=line,
                    date__in=delete_dates
                ).delete()[0]

            # 既存データを取得（一括取得）
            existing_plans_list = DailyAssenblyProductionPlan.objects.filter(
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
                    for item_name, production_quantity in items_data.items():
                        item_pk = item_dict.get(item_name)
                        if not item_pk:
                            continue

                        # 既存データのキー
                        key = (date_obj, shift_name, item_pk)
                        existing_plan = existing_plans.get(key)

                        if existing_plan:
                            # 更新
                            existing_plan.production_quantity = production_quantity
                            existing_plan.stop_time = stop_time
                            existing_plan.overtime = overtime
                            existing_plan.occupancy_rate = (occupancy_rate / 100) if occupancy_rate is not None else None
                            existing_plan.regular_working_hours = regular_working_hours
                            existing_plan.last_updated_user = username
                            plans_to_update.append(existing_plan)
                        else:
                            # 新規作成
                            plans_to_create.append(DailyAssenblyProductionPlan(
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
            if plans_to_update:
                DailyAssenblyProductionPlan.objects.bulk_update(
                    plans_to_update,
                    ['production_quantity', 'stop_time', 'overtime', 'occupancy_rate', 'regular_working_hours', 'last_updated_user']
                )

            if plans_to_create:
                DailyAssenblyProductionPlan.objects.bulk_create(plans_to_create)

            message_parts = []
            if deleted_count > 0:
                message_parts.append(f'削除: {deleted_count}件')
            if len(plans_to_update) > 0:
                message_parts.append(f'更新: {len(plans_to_update)}件')
            if len(plans_to_create) > 0:
                message_parts.append(f'新規: {len(plans_to_create)}件')

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
