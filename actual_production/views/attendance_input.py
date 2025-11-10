from django.shortcuts import render
from django.views import View
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.db.models import Q
from django.db import transaction
from actual_production.models import (
    AttendanceSelect, ActualProductionItem, AttendanceProductionMapping,
    AttendanceRecord, AttendanceTask, AttendanceSupport
)
from management_room.models import Employee, Department
from manufacturing.models import Line
from datetime import datetime, time
import json

class AttendanceInputView(View):
    template_name = 'attendance_input/full_page.html'

    def get(self, request):
        # 従業員名取得のAjaxリクエスト
        if request.path.endswith('/get-employee/'):
            employee_number = request.GET.get('employee_number')
            if not employee_number:
                return JsonResponse({
                    'status': 'error',
                    'message': '社員番号を指定してください'
                }, status=400)

            try:
                employee = Employee.objects.get(employee_number=employee_number)
                return JsonResponse({
                    'status': 'success',
                    'employee_name': employee.name,
                    'employee_id': employee.id
                })
            except Employee.DoesNotExist:
                return JsonResponse({
                    'status': 'error',
                    'message': '指定された社員番号の従業員が見つかりません'
                }, status=404)

        # 通常のページ表示
        try:
            # 勤怠選択肢を取得（有効なもののみ、並び順でソート）
            attendance_selects = AttendanceSelect.objects.filter(active=True).order_by('order', 'name')

            # 従業員を取得（現在在籍中の従業員のみ）
            employees = Employee.objects.filter(
                department_employee__leave_date__isnull=True
            ).select_related('user').distinct().order_by('name')

            # 実績生産品目を取得（有効なもののみ）
            actual_production_items = ActualProductionItem.objects.filter(active=True).order_by('code', 'name')

            # 部署を取得（有効なもののみ）
            departments = Department.objects.filter(active=True).order_by('name')

            # ラインを取得（有効なもののみ）
            lines = Line.objects.filter(active=True).order_by('name')

            # 現在時刻を取得
            current_time = datetime.now()
            current_hour = current_time.hour

            # 開始時間の初期値を設定（11時までは20時、23時までは8時の交代制）
            if current_hour <= 11:
                default_start_time = "20:00"
            elif current_hour <= 23:
                default_start_time = "08:00"
            else:
                default_start_time = "20:00"

            # 今日の日付
            today = current_time.strftime("%Y-%m-%d")

            context = {
                'attendance_selects': attendance_selects,
                'employees': employees,
                'actual_production_items': actual_production_items,
                'departments': departments,
                'lines': lines,
                'default_start_time': default_start_time,
                'today': today,
            }

            return render(request, self.template_name, context)

        except Exception as e:
            return render(request, self.template_name, {
                'error_message': f'データの取得中にエラーが発生しました: {str(e)}'
            })

@method_decorator(csrf_exempt, name='dispatch')
class AttendanceInputSubmitView(View):
    def post(self, request):
        try:
            data = json.loads(request.body)

            # 基本データの取得
            employee_number = data.get('employee_number')
            attendance_date = data.get('attendance_date')
            shift_type = data.get('shift_type', 'day')
            start_time = data.get('start_time')
            end_time = data.get('end_time')
            production_overtime = data.get('production_overtime', 0)
            own_line_operation_hours = data.get('own_line_operation_hours', 0)

            # 業務データ
            tasks = data.get('tasks', [])

            # 応援データ
            supports = data.get('supports', [])

            # バリデーション
            if not employee_number:
                return JsonResponse({
                    'status': 'error',
                    'message': '社員番号を入力してください'
                }, status=400)

            if not attendance_date:
                return JsonResponse({
                    'status': 'error',
                    'message': '日付を入力してください'
                }, status=400)

            if not start_time or not end_time:
                return JsonResponse({
                    'status': 'error',
                    'message': '開始時間と終了時間を入力してください'
                }, status=400)

            # 夜勤対応の時間バリデーション
            try:
                start_dt = datetime.strptime(start_time, '%H:%M').time()
                end_dt = datetime.strptime(end_time, '%H:%M').time()

                # 夜勤の場合の勤務時間計算
                start_datetime = datetime.combine(datetime.today(), start_dt)
                end_datetime = datetime.combine(datetime.today(), end_dt)

                # 終了時間が開始時間より前の場合は翌日とみなす（夜勤）
                if end_dt <= start_dt:
                    end_datetime += timezone.timedelta(days=1)

                # 勤務時間が24時間を超えないかチェック
                work_duration = end_datetime - start_datetime
                if work_duration.total_seconds() > 24 * 60 * 60:
                    return JsonResponse({
                        'status': 'error',
                        'message': '勤務時間が24時間を超えています'
                    }, status=400)

            except ValueError:
                return JsonResponse({
                    'status': 'error',
                    'message': '時間の形式が正しくありません'
                }, status=400)

            # 従業員の存在確認
            try:
                employee = Employee.objects.get(employee_number=employee_number)
            except Employee.DoesNotExist:
                return JsonResponse({
                    'status': 'error',
                    'message': '指定された社員番号の従業員が見つかりません'
                }, status=404)

            # データベースに保存
            with transaction.atomic():
                # メインレコードの作成/更新
                attendance_record, created = AttendanceRecord.objects.update_or_create(
                    employee=employee,
                    attendance_date=attendance_date,
                    defaults={
                        'shift_type': shift_type,
                        'start_time': start_time,
                        'end_time': end_time,
                        'production_overtime': production_overtime,
                        'own_line_operation_hours': own_line_operation_hours,
                        'last_updated_user': request.user.username if request.user.is_authenticated else None
                    }
                )

                # 既存の業務内容・応援を削除
                attendance_record.tasks.all().delete()
                attendance_record.supports.all().delete()

                # 0以外の業務内容のみ保存
                tasks_saved = 0
                for task in tasks:
                    if task['hours'] > 0:
                        AttendanceTask.objects.create(
                            attendance_record=attendance_record,
                            attendance_select_id=task['attendance_select_id'],
                            hours=task['hours'],
                            overtime=task['overtime']
                        )
                        tasks_saved += 1

                # 0以外の応援のみ保存
                supports_saved = 0
                for support in supports:
                    if support['hours'] > 0:
                        AttendanceSupport.objects.create(
                            attendance_record=attendance_record,
                            line_id=support['line_id'],
                            hours=support['hours'],
                            overtime=support['overtime']
                        )
                        supports_saved += 1

            return JsonResponse({
                'status': 'success',
                'message': f'勤怠データを保存しました（業務内容: {tasks_saved}件、応援: {supports_saved}件）',
                'data': {
                    'employee': employee.name,
                    'date': attendance_date,
                    'start_time': start_time,
                    'end_time': end_time,
                    'production_overtime': production_overtime,
                    'own_line_operation_hours': own_line_operation_hours,
                    'tasks_saved': tasks_saved,
                    'supports_saved': supports_saved,
                    'created': created
                }
            })

        except json.JSONDecodeError:
            return JsonResponse({
                'status': 'error',
                'message': '無効なJSONデータです'
            }, status=400)
        except ValueError as e:
            return JsonResponse({
                'status': 'error',
                'message': f'データ形式エラー: {str(e)}'
            }, status=400)
        except AttendanceSelect.DoesNotExist:
            return JsonResponse({
                'status': 'error',
                'message': '指定された勤怠選択肢が見つかりません'
            }, status=404)
        except Line.DoesNotExist:
            return JsonResponse({
                'status': 'error',
                'message': '指定されたラインが見つかりません'
            }, status=404)
        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': f'保存中にエラーが発生しました: {str(e)}'
            }, status=500)
