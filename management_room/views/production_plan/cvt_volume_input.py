from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render, redirect
from django.contrib import messages
from django.http import JsonResponse
from management_room.models import CVTItem, MonthlyCVTProductionPlan
from manufacturing.models import CVTLine
from datetime import date, datetime
import json
import pandas as pd

class CVTVolumeInputView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/cvt_volume_input.html'

    def get(self, request, *args, **kwargs):
        # Ajax リクエストの場合はJSON形式でデータを返す
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            target_month = request.GET.get('month')
            if target_month:
                year, month = map(int, target_month.split('-'))
                month_date = date(year, month, 1)

                # その月の生産計画を取得してDataFrameに変換
                plans = MonthlyCVTProductionPlan.objects.filter(
                    month=month_date
                ).select_related('production_item', 'line').values(
                    'production_item__name', 'line_id', 'quantity'
                )

                if plans:
                    df = pd.DataFrame(plans)
                    df.columns = ['item_name', 'line_id', 'quantity']
                    # ピボットテーブルで整形
                    data = df.set_index('item_name').groupby('item_name').apply(
                        lambda x: dict(zip(x['line_id'].astype(str), x['quantity']))
                    ).to_dict()
                else:
                    data = {}

                return JsonResponse({'data': data})

        # 今月を取得
        today = date.today()
        year = today.year
        month = today.month
        month_date = date(year, month, 1)

        # 全てのアクティブなAssemblyLineを取得
        cvt_lines = CVTLine.objects.filter(active=True).order_by('name')

        # 全てのアクティブなAssemblyItemを取得してDataFrameに変換
        cvt_items = CVTItem.objects.filter(active=True).select_related('line').values(
            'id', 'name', 'line__id', 'line__name'
        ).order_by('name')

        # DataFrameに変換
        df_items = pd.DataFrame(cvt_items)
        df_items.columns = ['item_id', 'name', 'line_id', 'line_name']

        # その月の生産計画を取得
        plans = MonthlyCVTProductionPlan.objects.filter(
            month=month_date
        ).select_related('production_item', 'line').values(
            'production_item__name', 'line_id', 'quantity'
        )
        df_plans = pd.DataFrame(plans) if plans else pd.DataFrame(columns=['production_item__name', 'line_id', 'quantity'])

        # 品番リストを作成
        item_list = []
        for name, group in df_items.groupby('name'):
            item_data = {'name': name}
            available_lines = []
            available_line_ids = []
            line_quantities = {}

            for _, row in group.iterrows():
                if pd.notna(row['line_id']):
                    line_name = row['line_name']
                    line_id = int(row['line_id'])

                    # ラインごとの情報をフラットに展開
                    item_data[f'{line_name}_item_id'] = int(row['item_id'])
                    available_lines.append(line_name)
                    available_line_ids.append(str(line_id))

                    # 既存の数量を取得
                    if not df_plans.empty:
                        plan_row = df_plans[
                            (df_plans['production_item__name'] == name) &
                            (df_plans['line_id'] == line_id)
                        ]
                        if not plan_row.empty:
                            line_quantities[str(line_id)] = int(plan_row.iloc[0]['quantity'])

            total_quantity = sum(line_quantities.values())
            item_data['available_lines'] = available_lines
            item_data['available_line_ids'] = available_line_ids
            item_data['planned_volume'] = total_quantity if total_quantity > 0 else None
            item_data['line_quantities'] = json.dumps(line_quantities)
            item_list.append(item_data)

        context = {
            'item_list': item_list,
            'assembly_lines': cvt_lines,
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
                return redirect('management_room:cvt_volume_input')

            # "YYYY-MM"形式をDateFieldに変換（月の1日）
            year, month = map(int, target_month.split('-'))
            month_date = date(year, month, 1)

            # JSONデータを取得
            production_data_json = request.POST.get('production_data')
            if not production_data_json:
                messages.error(request, '生産データがありません。')
                return redirect('management_room:cvt_volume_input')

            production_data = json.loads(production_data_json)

            # 既存のデータを削除
            MonthlyCVTProductionPlan.objects.filter(month=month_date).delete()

            # 登録件数
            created_count = 0

            # 各データを処理
            for data in production_data:
                item_name = data['item_name']
                line_id = data['line_id']
                quantity = data['quantity']

                # AssemblyItemを取得（品番とラインで特定）
                try:
                    cvt_item = CVTItem.objects.get(
                        name=item_name,
                        line_id=line_id,
                        active=True
                    )
                    cvt_line = CVTLine.objects.get(id=line_id)

                    MonthlyCVTProductionPlan.objects.create(
                        month=month_date,
                        line=cvt_line,
                        production_item=cvt_item,
                        quantity=quantity
                    )
                    created_count += 1

                except CVTItem.DoesNotExist:
                    continue
                except CVTLine.DoesNotExist:
                    continue

            messages.success(request, f'{target_month}の生産計画を登録しました。（{created_count}件）')
            return redirect('/management_room/production-plan/assembly-production-plan/')

        except Exception as e:
            messages.error(request, f'登録に失敗しました: {str(e)}')
            return redirect('management_room:production_volume_input')
