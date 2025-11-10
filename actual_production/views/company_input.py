from django.shortcuts import render
from django.views import View
from django.http import JsonResponse
from django.utils import timezone
from django.db.models import Q
from actual_production.models import AttendanceRecord
from management_room.models import Employee
from manufacturing.models import Line
from datetime import datetime, timedelta
import json

class CompanyInputView(View):
    template_dir = 'company_input'

    def get(self, request):
        # Ajax リクエストの場合
        if request.path.endswith('/data/'):
            return self.get_attendance_data(request)

        try:
            is_htmx = request.headers.get('HX-Request')

            # 今日の日付
            today = timezone.now().strftime("%Y-%m-%d")

            # ラインを取得
            lines = Line.objects.filter(active=True).order_by('name')

            context = {
                'today': today,
                'lines': lines,
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

    def convert_to_48hour_format(self, time_obj, shift_type, date_obj):
        """夜勤の場合48時間表記に変換"""
        if shift_type != 'night':
            return time_obj.strftime('%H:%M'), date_obj.strftime('%Y-%m-%d')

        hour = time_obj.hour
        minute = time_obj.minute

        # 夜勤の場合、0-11時は翌日の24-35時として表示
        if hour <= 11:
            display_hour = hour + 24
            # 日付は前日を表示
            display_date = (date_obj - timedelta(days=1)).strftime('%Y-%m-%d')
        else:
            display_hour = hour
            display_date = date_obj.strftime('%Y-%m-%d')

        return f"{display_hour:02d}:{minute:02d}", display_date

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

    def _build_attendance_query(self, date_obj, shift_type, line_id):
        """勤怠データ取得用のクエリを構築"""
        query = Q(attendance_date=date_obj)

        if shift_type != 'all':
            query &= Q(shift_type=shift_type)

        if line_id:
            query &= Q(employee__line_id=line_id)

        return query

    def _format_attendance_record(self, record, shift_type, date_obj):
        """勤怠レコードを表示用に整形"""
        display_shift_type = shift_type if shift_type != 'all' else record.shift_type

        start_time_display, start_date_display = self.convert_to_48hour_format(
            record.start_time, display_shift_type, date_obj
        )
        end_time_display, end_date_display = self.convert_to_48hour_format(
            record.end_time, display_shift_type, date_obj
        )

        return {
            'employee_number': record.employee.employee_number,
            'employee_name': record.employee.name,
            'start_time': start_time_display,
            'end_time': end_time_display,
            'start_date': start_date_display,
            'end_date': end_date_display,
            'line_name': record.employee.line.name if record.employee.line else '',
            'start_hour_48': int(start_time_display.split(':')[0]),
        }

    def get_attendance_data(self, request):
        """勤怠データを取得してJSONで返す"""
        try:
            # パラメータ取得
            date_str = request.GET.get('date')
            shift_type = request.GET.get('shift_type', 'day')
            line_id = request.GET.get('line_id')

            # 日付検証
            date_obj, error_response = self._validate_date_parameter(date_str)
            if error_response:
                return error_response

            # クエリ構築
            query = self._build_attendance_query(date_obj, shift_type, line_id)

            # データ取得
            attendance_records = AttendanceRecord.objects.filter(
                query
            ).select_related('employee', 'employee__line').order_by('employee__line__name')

            # データ整形
            data = [
                self._format_attendance_record(record, shift_type, date_obj)
                for record in attendance_records
            ]

            # 48時間表記での時間順にソート
            data.sort(key=lambda x: (x['line_name'], x['start_hour_48']))

            return JsonResponse({
                'status': 'success',
                'data': data,
                'count': len(data)
            })

        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': f'データの取得中にエラーが発生しました: {str(e)}'
            }, status=500)