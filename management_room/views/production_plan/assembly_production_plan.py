from management_room.models import DailyAssenblyProductionPlan, AssemblyItem
from manufacturing.models import AssemblyLine
from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.utils.decorators import method_decorator
from datetime import datetime, timedelta
import json
import calendar
import math

class AssemblyProductionPlanView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/assembly_production_plan.html'


    def days_in_month(year: int, month: int) -> list[int]:
        # monthrange は (曜日, 月の日数) を返す
        _, last_day = calendar.monthrange(year, month)
        return list(range(1, last_day + 1))


    def get(self, request, *args, **kwargs):
        if request.GET.get('year') and request.GET.get('month'):
            year = int(request.GET.get('year'))
            month = int(request.GET.get('month'))
        else:
            year = datetime.now().year
            month = datetime.now().month

        start_date = datetime(year, month, 1).date()
        end_date = datetime(year, month, calendar.monthrange(year, month)[1]).date()

        # 組付ラインを取得
        if request.GET.get('line'):
            line = AssemblyLine.objects.get(id=request.GET.get('line'))
        else:
            line = AssemblyLine.objects.filter(active=True).order_by('name').first()

        # 品番を取得（このラインの完成品番）
        items = AssemblyItem.objects.filter(line=line, active=True).values('name').distinct().order_by('name')
        item_names = [item['name'] for item in items]

        # データを取得
        plans = DailyAssenblyProductionPlan.objects.filter(
            line=line,
            date__gte=start_date,
            date__lte=end_date
        ).select_related('production_item').order_by('date', 'production_item', 'shift')

        for plan in plans:
            print(plan.date)


        # 日付リストを生成
        dates = []
        current_date = start_date
        # ラインの稼働率を取得（パーセント表示用に100倍）
        default_occupancy_rate = (line.occupancy_rate * 100) if line.occupancy_rate else ''

        while current_date <= end_date:
            is_weekend = current_date.weekday() >= 5
            # 週末の場合、その日にDailyAssenblyProductionPlanデータがあるかチェック
            has_weekend_work = False
            if is_weekend:
                has_weekend_work = DailyAssenblyProductionPlan.objects.filter(
                    line=line,
                    date=current_date,
                    shift='day'
                ).exists()

            dates.append({
                'date': current_date,
                'day': current_date.day,
                'weekday': current_date.weekday(),
                'is_weekend': is_weekend,
                'occupancy_rate': default_occupancy_rate,
                'has_weekend_work': has_weekend_work
            })
            current_date += timedelta(days=1)

        # 生産数データを辞書形式で取得
        # DailyAssenblyProductionPlanから取得
        production_plans_dict = {}
        for plan in plans:
            if plan.production_item:
                key = (plan.production_item.name, plan.date, plan.shift)
                production_plans_dict[key] = plan

        # 生産数データを整形（品番 × シフト × 日付）
        production_data_day = []
        production_data_night = []

        for item_name in item_names:
            # 日勤
            day_row = {'item_name': item_name, 'cells': []}
            for date_info in dates:
                # 辞書から生産数を取得
                key = (item_name, date_info['date'], 'day')
                plan = production_plans_dict.get(key)
                count = plan.production_quantity if plan and plan.production_quantity else 0

                day_row['cells'].append({
                    'value': count if count > 0 else '',
                    'is_weekend': date_info['is_weekend']
                })
            production_data_day.append(day_row)

            # 夜勤
            night_row = {'item_name': item_name, 'cells': []}
            for date_info in dates:
                # 辞書から生産数を取得
                key = (item_name, date_info['date'], 'night')
                plan = production_plans_dict.get(key)
                count = plan.production_quantity if plan and plan.production_quantity else 0

                night_row['cells'].append({
                    'value': count if count > 0 else '',
                    'is_weekend': date_info['is_weekend']
                })
            production_data_night.append(night_row)

        # 計画停止データを整形（ライン全体 × シフト × 日付）
        # 組付は品番ごとではなく、ライン全体で1行のみ
        stop_time_data_day = []
        stop_time_data_night = []

        day_row = {'cells': []}
        night_row = {'cells': []}
        for date_info in dates:
            # 日勤の計画停止時間を取得（全品番の合計ではなく、ライン全体の値）
            # どの品番でも同じ値を使うため、最初の品番のデータを使用
            stop_time_value = ''
            if not date_info['is_weekend'] and item_names:
                day_key = (item_names[0], date_info['date'], 'day')
                day_plan = production_plans_dict.get(day_key)
                stop_time_value = day_plan.stop_time if day_plan and day_plan.stop_time is not None else 0

            day_row['cells'].append({
                'value': stop_time_value,
                'is_weekend': date_info['is_weekend']
            })

            # 夜勤の計画停止時間を取得
            stop_time_value_night = ''
            if not date_info['is_weekend'] and item_names:
                night_key = (item_names[0], date_info['date'], 'night')
                night_plan = production_plans_dict.get(night_key)
                stop_time_value_night = night_plan.stop_time if night_plan and night_plan.stop_time is not None else 0

            night_row['cells'].append({
                'value': stop_time_value_night,
                'is_weekend': date_info['is_weekend']
            })
        stop_time_data_day.append(day_row)
        stop_time_data_night.append(night_row)

        # 残業計画データを整形（ライン全体 × シフト × 日付）
        # 組付は品番ごとではなく、ライン全体で1行のみ
        overtime_data_day = []
        overtime_data_night = []

        day_row = {'cells': []}
        night_row = {'cells': []}
        for date_info in dates:
            # 日勤の残業時間を取得（全品番の合計ではなく、ライン全体の値）
            # どの品番でも同じ値を使うため、最初の品番のデータを使用
            overtime_value = ''
            if not date_info['is_weekend'] and item_names:
                day_key = (item_names[0], date_info['date'], 'day')
                day_plan = production_plans_dict.get(day_key)
                overtime_value = day_plan.overtime if day_plan and day_plan.overtime is not None else 0

            day_row['cells'].append({
                'value': overtime_value,
                'is_weekend': date_info['is_weekend']
            })

            # 夜勤の残業時間を取得
            overtime_value_night = ''
            if not date_info['is_weekend'] and item_names:
                night_key = (item_names[0], date_info['date'], 'night')
                night_plan = production_plans_dict.get(night_key)
                overtime_value_night = night_plan.overtime if night_plan and night_plan.overtime is not None else 0

            night_row['cells'].append({
                'value': overtime_value_night,
                'is_weekend': date_info['is_weekend']
            })
        overtime_data_day.append(day_row)
        overtime_data_night.append(night_row)

        # 品番ごとのタクトを取得（計算用）
        item_data = {}
        for item_name in item_names:
            # 品番名で最初に見つかったアイテムのタクトを使用
            item_obj = AssemblyItem.objects.filter(
                line=line,
                name=item_name,
                active=True
            ).first()
            if item_obj and item_obj.line:
                item_data[item_name] = {
                    'tact': item_obj.line.tact if item_obj.line.tact else 0,
                }

        lines = AssemblyLine.objects.filter(active=True).order_by('name')
        lines_list = [{'id': l.id, 'name': l.name} for l in lines]

        # 生産数セクションの行数を計算
        production_total_rows = len(item_names) * 2  # 日勤 + 夜勤

        context = {
            'year': year,
            'month': month,
            'line': line,
            'dates': dates,
            'item_names': item_names,
            'production_data_day': production_data_day,
            'production_data_night': production_data_night,
            'stop_time_data_day': stop_time_data_day,
            'stop_time_data_night': stop_time_data_night,
            'overtime_data_day': overtime_data_day,
            'overtime_data_night': overtime_data_night,
            'lines': lines_list,
            'production_total_rows': production_total_rows,
        }

        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        """組付生産計画データを保存"""
        try:
            # JSONデータを取得
            data = json.loads(request.body)
            print(data)
            plan_data = data.get('plan_data', [])
            occupancy_rates = data.get('occupancy_rates', [])

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
                line = AssemblyLine.objects.get(id=request.GET.get('line'))
            else:
                line = AssemblyLine.objects.filter(active=True).order_by('name').first()

            # 日付リストを生成
            dates = []
            current_date = start_date
            while current_date <= end_date:
                dates.append(current_date)
                current_date += timedelta(days=1)

            # 品番ごとのデータをグループ化
            # キー: (品番, 日付インデックス, シフト)
            grouped_data = {}

            for item in plan_data:
                date_index = item.get('date_index')
                shift = item.get('shift')
                item_name = item.get('item_name')
                production_quantity = item.get('production_quantity')
                stop_time = item.get('stop_time')
                overtime = item.get('overtime')

                # キーを作成: (品番, 日付インデックス, シフト)
                key = (item_name, date_index, shift)

                if key not in grouped_data:
                    grouped_data[key] = {
                        'item_name': item_name,
                        'date_index': date_index,
                        'shift': shift,
                        'production_quantity': None,
                        'stop_time': None,
                        'overtime': None
                    }

                # 各フィールドを設定
                if production_quantity is not None:
                    grouped_data[key]['production_quantity'] = production_quantity
                if stop_time is not None:
                    grouped_data[key]['stop_time'] = stop_time
                if overtime is not None:
                    grouped_data[key]['overtime'] = overtime

            # データベースに保存
            saved_count = 0
            for key, data in grouped_data.items():
                item_name = data['item_name']
                date_index = data['date_index']
                shift = data['shift']
                production_quantity = data['production_quantity']
                stop_time = data['stop_time']
                overtime = data['overtime']

                # 日付を取得
                if date_index >= len(dates):
                    continue
                date = dates[date_index]

                # 品番を取得
                production_item = AssemblyItem.objects.filter(
                    line=line,
                    name=item_name,
                    active=True
                ).first()

                if not production_item:
                    continue

                # DailyAssenblyProductionPlanに保存
                defaults = {
                    'last_updated_user': request.user.username if request.user.is_authenticated else 'system'
                }
                if production_quantity is not None:
                    defaults['production_quantity'] = production_quantity
                if stop_time is not None:
                    defaults['stop_time'] = stop_time
                if overtime is not None:
                    defaults['overtime'] = overtime

                DailyAssenblyProductionPlan.objects.update_or_create(
                    line=line,
                    production_item=production_item,
                    date=date,
                    shift=shift,
                    defaults=defaults
                )
                saved_count += 1

            # 稼働率データを保存（ライン単位）
            # 稼働率は今回は保存しない（必要に応じて後で実装）

            return JsonResponse({
                'status': 'success',
                'message': f'{saved_count}件のデータを保存しました'
            })

        except Exception as e:
            import traceback
            return JsonResponse({
                'status': 'error',
                'message': str(e),
                'traceback': traceback.format_exc()
            }, status=400)
