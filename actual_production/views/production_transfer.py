from django.shortcuts import render
from django.views import View
from django.http import JsonResponse
from django.utils import timezone
from django.db.models import Q, Sum, Count
from actual_production.models import (
    ActualProductionItem, AttendanceProductionMapping,
    AttendanceRecord, AttendanceTask
)
from manufacturing.models import Line
from management_room.models import Employee
from datetime import datetime
import json

class ProductionTransferView(View):
    template_dir = 'production_transfer'

    def get(self, request):
        # Ajax リクエストの場合
        if request.path.endswith('/data/'):
            return self.get_production_data(request)
        elif request.path.endswith('/items/'):
            return self.get_production_items(request)

        try:
            is_htmx = request.headers.get('HX-Request')

            # 今日の日付
            today = timezone.now().strftime("%Y-%m-%d")

            # ラインを取得
            lines = Line.objects.filter(active=True).order_by('name')

            # 実績品目を取得
            production_items = ActualProductionItem.objects.filter(active=True).order_by('code', 'name')

            context = {
                'today': today,
                'lines': lines,
                'production_items': production_items,
            }

            # HTMX要求時はコンテンツ部分のみ返す
            if is_htmx:
                content_template = self.template_dir + '/content.html'
                return render(request, content_template, context)

            # 通常アクセス時は完全なページを返す
            self.template_name = self.template_dir + '/index.html'
            return render(request, self.template_name, context)

        except Exception as e:
            template_name = self.template_dir + '/index.html'
            return render(request, template_name, {
                'error_message': f'ページの表示中にエラーが発生しました: {str(e)}'
            })

    def _validate_date_parameter(self, date_str):
        """日付パラメータの検証"""
        if not date_str:
            return None, JsonResponse({
                'status': 'error',
                'message': '日付を指定してください'
            }, status=400)

        try:
            return datetime.strptime(date_str, '%Y-%m-%d').date(), None
        except ValueError:
            return None, JsonResponse({
                'status': 'error',
                'message': '日付形式が正しくありません'
            }, status=400)

    def _build_production_query(self, date_obj, line_id, shift_type=None):
        """実績データ取得用のクエリを構築"""
        query = Q(attendance_record__attendance_date=date_obj)

        if line_id:
            query &= Q(attendance_record__employee__line_id=line_id)

        if shift_type:
            query &= Q(attendance_record__shift_type=shift_type)

        return query

    def get_production_data(self, request):
        """実績データを取得してJSONで返す"""
        try:
            # パラメータ取得
            date_str = request.GET.get('date')
            line_id = request.GET.get('line_id')
            shift_type = request.GET.get('shift_type')

            # 日付検証
            date_obj, error_response = self._validate_date_parameter(date_str)
            if error_response:
                return error_response

            # 紐付けのある実績生産品目を取得
            production_items = ActualProductionItem.objects.filter(
                active=True,
                attendanceproductionmapping__active=True
            ).distinct().order_by('code', 'name')

            # ライン別の総人数を計算（最初に計算）
            attendance_query = Q(attendance_date=date_obj)
            if line_id:
                attendance_query &= Q(employee__line_id=line_id)
            if shift_type:
                attendance_query &= Q(shift_type=shift_type)

            # 出勤者数（勤怠記録がある人）
            total_attendance = AttendanceRecord.objects.filter(attendance_query).count()

            # ライン作業をしている人数
            total_line_people = AttendanceRecord.objects.filter(attendance_query).filter(
                Q(own_line_operation_hours__gt=0) | Q(production_overtime__gt=0)
            ).count()

            # 自ライン稼働時間と生産残業時間の合計を計算
            line_totals = AttendanceRecord.objects.filter(attendance_query).aggregate(
                total_line_operation=Sum('own_line_operation_hours'),
                total_production_overtime=Sum('production_overtime')
            )
            total_line_operation_hours = line_totals['total_line_operation'] or 0
            total_production_overtime_hours = line_totals['total_production_overtime'] or 0

            data = []
            total_hours = 0

            for item in production_items:
                # この実績品目に紐付く勤怠選択肢を取得
                mappings = AttendanceProductionMapping.objects.filter(
                    actual_production_item=item,
                    active=True
                ).select_related('attendance_select')

                attendance_select_ids = [mapping.attendance_select.id for mapping in mappings]

                # クエリ構築
                query = self._build_production_query(date_obj, line_id, shift_type)
                query &= Q(attendance_select_id__in=attendance_select_ids)

                # 該当する業務タスクを取得して集計
                tasks = AttendanceTask.objects.filter(query)

                # 通常時間と残業時間を分けて集計
                normal_hours = tasks.filter(overtime=False).aggregate(total=Sum('hours'))['total'] or 0
                overtime_hours = tasks.filter(overtime=True).aggregate(total=Sum('hours'))['total'] or 0
                item_hours = normal_hours + overtime_hours

                data.append({
                    'item_code': item.code,
                    'item_name': item.name,
                    'normal_hours': float(normal_hours),
                    'overtime_hours': float(overtime_hours),
                    'total_hours': float(item_hours),
                })

                total_hours += float(item_hours)

            return JsonResponse({
                'status': 'success',
                'data': data,
                'total_hours': total_hours,
                'total_attendance': total_attendance,
                'total_line_people': total_line_people,
                'line_operation_hours': float(total_line_operation_hours),
                'production_overtime_hours': float(total_production_overtime_hours),
                'count': len(data)
            })

        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': f'データの取得中にエラーが発生しました: {str(e)}'
            }, status=500)

    def get_production_items(self, request):
        """実績品目リストを返す"""
        try:
            items = ActualProductionItem.objects.filter(active=True).order_by('code', 'name')

            data = [
                {
                    'id': item.id,
                    'code': item.code,
                    'name': item.name
                }
                for item in items
            ]

            return JsonResponse({
                'status': 'success',
                'items': data
            })

        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': f'実績品目の取得中にエラーが発生しました: {str(e)}'
            }, status=500)

    def post(self, request):
        """実績データの保存"""
        try:
            data = json.loads(request.body)

            date_str = data.get('date')
            line_id = data.get('line_id')
            shift_type = data.get('shift_type')
            input_data = data.get('data', [])

            # 日付検証
            date_obj, error_response = self._validate_date_parameter(date_str)
            if error_response:
                return error_response

            if not input_data:
                return JsonResponse({
                    'status': 'error',
                    'message': '入力データがありません'
                }, status=400)

            # ここで保存処理を実装（必要に応じて）
            # 現在は成功レスポンスのみ返す
            return JsonResponse({
                'status': 'success',
                'message': '実績データを保存しました'
            })

        except json.JSONDecodeError:
            return JsonResponse({
                'status': 'error',
                'message': '無効なJSONデータです'
            }, status=400)
        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': f'保存中にエラーが発生しました: {str(e)}'
            }, status=500)