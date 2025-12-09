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

                # その月の生産計画を取得
                plans = MonthlyCVTProductionPlan.objects.filter(
                    month=month_date
                ).select_related('production_item').values(
                    'production_item__name', 'quantity'
                )

                # 品番ごとの数量をマッピング
                data = {plan['production_item__name']: plan['quantity'] for plan in plans}

                return JsonResponse({'data': data})

        # 今月を取得
        today = date.today()
        year = today.year
        month = today.month
        month_date = date(year, month, 1)

        # 全てのアクティブなCVTLineを取得
        cvt_lines = CVTLine.objects.filter(active=True).order_by('name')

        # 全てのアクティブなCVTItemを取得してDataFrameに変換
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

        # 品番リストを作成（各品番は1つのラインのみ）
        item_list = []
        for name, group in df_items.groupby('name'):
            # 各品番は1つのラインのみ
            first_row = group.iloc[0]

            item_data = {
                'name': name,
                'item_id': int(first_row['item_id']),
                'line_id': int(first_row['line_id']),
                'line_name': first_row['line_name'],
            }

            # 既存の数量を取得
            planned_volume = None
            if not df_plans.empty:
                plan_row = df_plans[
                    (df_plans['production_item__name'] == name) &
                    (df_plans['line_id'] == int(first_row['line_id']))
                ]
                if not plan_row.empty:
                    planned_volume = int(plan_row.iloc[0]['quantity'])

            item_data['planned_volume'] = planned_volume
            item_list.append(item_data)

        context = {
            'item_list': item_list,
            'cvt_lines': cvt_lines,
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

            # 登録件数とエラー件数
            created_count = 0
            error_items = []

            # 各データを処理
            for data in production_data:
                item_name = data.get('item_name')
                line_id = data.get('line_id')
                quantity = data.get('quantity')

                # データの妥当性チェック
                if not item_name or not line_id or not quantity:
                    continue

                try:
                    # CVTItemを取得（品番とラインで特定）
                    cvt_item = CVTItem.objects.get(
                        name=item_name,
                        line_id=line_id,
                        active=True
                    )
                    cvt_line = CVTLine.objects.get(id=line_id, active=True)

                    # 生産計画を作成
                    MonthlyCVTProductionPlan.objects.create(
                        month=month_date,
                        line=cvt_line,
                        production_item=cvt_item,
                        quantity=quantity
                    )
                    created_count += 1

                except CVTItem.DoesNotExist:
                    error_items.append(f'{item_name}（品番が見つかりません）')
                except CVTLine.DoesNotExist:
                    error_items.append(f'{item_name}（ラインが見つかりません）')

            # 結果メッセージ
            if created_count > 0:
                success_msg = f'{target_month}の生産計画を登録しました。（{created_count}件）'
                if error_items:
                    success_msg += f' ※エラー: {", ".join(error_items[:3])}'
                    if len(error_items) > 3:
                        success_msg += f' 他{len(error_items) - 3}件'
                messages.success(request, success_msg)
            else:
                messages.warning(request, '登録できるデータがありませんでした。')

            return redirect('management_room:cvt_volume_input')

        except json.JSONDecodeError:
            messages.error(request, 'データ形式が不正です。')
            return redirect('management_room:cvt_volume_input')
        except ValueError as e:
            messages.error(request, f'日付形式が不正です: {str(e)}')
            return redirect('management_room:cvt_volume_input')
        except Exception as e:
            messages.error(request, f'登録に失敗しました: {str(e)}')
            return redirect('management_room:cvt_volume_input')
