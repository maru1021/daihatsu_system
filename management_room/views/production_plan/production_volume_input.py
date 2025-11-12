from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render, redirect
from django.contrib import messages
from django.http import JsonResponse
from management_room.models import AssemblyItem, MonthlyAssemblyProductionPlan
from manufacturing.models import AssemblyLine
from collections import defaultdict
from datetime import date, datetime
import json

class ProductionVolumeInputView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/production_volume_input.html'

    def get(self, request, *args, **kwargs):
        # Ajax リクエストの場合はJSON形式でデータを返す
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            target_month = request.GET.get('month')
            if target_month:
                year, month = map(int, target_month.split('-'))
                month_date = date(year, month, 1)

                # その月の生産計画を取得
                plans = MonthlyAssemblyProductionPlan.objects.filter(
                    month=month_date
                ).select_related('production_item', 'line')

                # データを整形
                data = {}
                for plan in plans:
                    item_name = plan.production_item.name
                    line_id = str(plan.line.id)

                    if item_name not in data:
                        data[item_name] = {}

                    data[item_name][line_id] = plan.Quantity

                return JsonResponse({'data': data})

        # 今月を取得
        today = date.today()
        year = today.year
        month = today.month
        month_date = date(year, month, 1)

        # 全てのアクティブなAssemblyLineを取得
        assembly_lines = AssemblyLine.objects.filter(active=True).order_by('name')

        # 全てのアクティブなAssemblyItemを取得
        assembly_items = AssemblyItem.objects.filter(active=True).select_related('line').order_by('name')

        # 品番ごとにグループ化
        item_dict = defaultdict(list)
        for item in assembly_items:
            item_dict[item.name].append(item)

        # その月の生産計画を取得
        plans = MonthlyAssemblyProductionPlan.objects.filter(
            month=month_date
        ).select_related('production_item', 'line')

        # 品番×ラインごとの数量を辞書化
        plan_dict = {}
        for plan in plans:
            key = f"{plan.production_item.name}_{plan.line.id}"
            plan_dict[key] = plan.Quantity

        # 品番リストを作成
        item_list = []
        for name, items in sorted(item_dict.items()):
            # 各ラインの情報を個別のフィールドとして保持
            item_data = {'name': name}
            available_lines = []
            available_line_ids = []
            main_line_name = None
            total_quantity = 0
            line_quantities = {}  # {line_id: quantity}

            for item in items:
                if item.line:
                    line_name = item.line.name
                    line_id = item.line.id
                    # ラインごとの情報をフラットに展開
                    item_data[f'{line_name}_item_id'] = item.id
                    item_data[f'{line_name}_tact'] = item.line.tact
                    available_lines.append(line_name)
                    available_line_ids.append(str(line_id))

                    # 既存の数量を取得
                    plan_key = f"{name}_{line_id}"
                    if plan_key in plan_dict:
                        quantity = plan_dict[plan_key]
                        line_quantities[str(line_id)] = quantity
                        total_quantity += quantity

                    # メインラインの設定
                    if item.main_line:
                        main_line_name = line_name

            item_data['available_lines'] = available_lines
            item_data['available_line_ids'] = available_line_ids
            item_data['main_line'] = main_line_name
            item_data['planned_volume'] = total_quantity if total_quantity > 0 else None
            item_data['line_quantities'] = json.dumps(line_quantities)  # JSON文字列に変換
            item_list.append(item_data)

        context = {
            'item_list': item_list,
            'assembly_lines': assembly_lines,
            'year': year,
            'month': month,
        }
        return render(request, self.template_file, context)

    def post(self, request, *args, **kwargs):
        try:
            # 対象月を取得
            target_month = request.POST.get('target_month')
            if not target_month:
                messages.error(request, '対象月を選択してください。')
                return redirect('management_room:production_volume_input')

            # "YYYY-MM"形式をDateFieldに変換（月の1日）
            year, month = map(int, target_month.split('-'))
            month_date = date(year, month, 1)

            # JSONデータを取得
            production_data_json = request.POST.get('production_data')
            if not production_data_json:
                messages.error(request, '生産データがありません。')
                return redirect('management_room:production_volume_input')

            production_data = json.loads(production_data_json)

            # 既存のデータを削除
            MonthlyAssemblyProductionPlan.objects.filter(month=month_date).delete()

            # 登録件数
            created_count = 0

            # 各データを処理
            for data in production_data:
                item_name = data['item_name']
                line_id = data['line_id']
                quantity = data['quantity']

                # AssemblyItemを取得（品番とラインで特定）
                try:
                    assembly_item = AssemblyItem.objects.get(
                        name=item_name,
                        line_id=line_id,
                        active=True
                    )
                    assembly_line = AssemblyLine.objects.get(id=line_id)

                    MonthlyAssemblyProductionPlan.objects.create(
                        month=month_date,
                        line=assembly_line,
                        production_item=assembly_item,
                        Quantity=quantity
                    )
                    created_count += 1

                except AssemblyItem.DoesNotExist:
                    continue
                except AssemblyLine.DoesNotExist:
                    continue

            messages.success(request, f'{target_month}の生産計画を登録しました。（{created_count}件）')
            return redirect('management_room:production_volume_input')

        except Exception as e:
            messages.error(request, f'登録に失敗しました: {str(e)}')
            return redirect('management_room:production_volume_input')
