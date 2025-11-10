from django.shortcuts import render
from django.http import JsonResponse
from django.views import View
from django.views.generic import TemplateView
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.db.models import Q
from .models import InRoom, Schedule
from management_room.models import Department, Employee
import json
from datetime import datetime, time


class InRoomInputView(TemplateView):
    template_name = 'input_page.html'


class InRoomStatusView(TemplateView):
    template_name = 'status_page.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        # 現在時刻を取得（午後かどうか判定用）
        current_time = datetime.now()
        is_afternoon = current_time.hour >= 12

        # 部署ごとに従業員をグループ化
        departments = Department.objects.filter(active=True, name__in=('管理室', '品質課', '技術課')).order_by('name')
        departments_with_employees = []

        # 年休・出張の全体集計用
        all_business_trip_employees = []
        all_annual_leave_employees = []
        all_morning_annual_leave_employees = []
        all_afternoon_annual_leave_employees = []

        for department in departments:
            # 部署に所属する従業員を取得（現在在籍中で在席管理がTrueの従業員にフィルタリング）
            employees = Employee.objects.filter(
                department_employee__department = department,
                department_employee__leave_date__isnull = True,
                in_room = True
            ).select_related('user').distinct()

            # 入退室情報を取得
            in_room_employees = []
            out_room_employees = []
            business_trip_employees = []
            annual_leave_employees = []
            morning_annual_leave_employees = []
            afternoon_annual_leave_employees = []

            for employee in employees:
                # InRoomレコードを取得または作成
                in_room, created = InRoom.objects.get_or_create(employee=employee)

                # 現在時刻のスケジュールを取得（複数の場合もある）
                current_time_obj = current_time.time()
                current_schedules = Schedule.objects.filter(
                    employee=employee,
                    start_time__lte=current_time_obj,
                    end_time__gte=current_time_obj
                ).order_by('start_time')

                # 従業員データを作成
                employee_data = {
                    'name': employee.name,
                    'phone': employee.phone_number,
                    'schedules': list(current_schedules),  # 複数のスケジュールをリストで渡す
                    'employee': employee,
                    'in_room': in_room
                }

                # ステータス別に分類（午後の場合、午前休みは通常扱い）
                if in_room.business_trip:
                    business_trip_employees.append(employee_data)
                    all_business_trip_employees.append(employee_data)
                elif in_room.annual_leave:
                    annual_leave_employees.append(employee_data)
                    all_annual_leave_employees.append(employee_data)
                elif in_room.morning_annual_leave and not is_afternoon:
                    morning_annual_leave_employees.append(employee_data)
                    all_morning_annual_leave_employees.append(employee_data)
                elif in_room.afternoon_annual_leave:
                    afternoon_annual_leave_employees.append(employee_data)
                    all_afternoon_annual_leave_employees.append(employee_data)
                elif in_room.is_in_room:
                    in_room_employees.append(employee_data)
                else:
                    out_room_employees.append(employee_data)

            # カウント計算（出張・年休・午後年休、午前年休（午前のみ）は在席扱い）
            special_status_count = (
                len(business_trip_employees) +
                len(annual_leave_employees) +
                len(afternoon_annual_leave_employees) +
                (len(morning_annual_leave_employees) if not is_afternoon else 0)
            )

            actual_in_room_count = len(in_room_employees)
            total_count = len(employees)

            departments_with_employees.append({
                'department': department,
                'in_room_employees': in_room_employees,
                'out_room_employees': out_room_employees,
                'in_room_count': actual_in_room_count,
                'special_status_count': special_status_count,
                'absence_count': (
                    len(business_trip_employees) +
                    len(annual_leave_employees) +
                    (len(morning_annual_leave_employees) if not is_afternoon else 0) +
                    len(afternoon_annual_leave_employees)
                ),
                'total_count': total_count,
                'is_afternoon': is_afternoon
            })

        context['departments_with_employees'] = departments_with_employees

        # 年休・出張カード用のデータ
        context['absence_card'] = {
            'business_trip_employees': all_business_trip_employees,
            'annual_leave_employees': all_annual_leave_employees,
            'morning_annual_leave_employees': all_morning_annual_leave_employees if not is_afternoon else [],
            'afternoon_annual_leave_employees': all_afternoon_annual_leave_employees,
            'total_count': (
                len(all_business_trip_employees) +
                len(all_annual_leave_employees) +
                (len(all_morning_annual_leave_employees) if not is_afternoon else 0) +
                len(all_afternoon_annual_leave_employees)
            ),
            'is_afternoon': is_afternoon
        }

        context['total_in_room'] = InRoom.objects.filter(in_room_time__isnull=False).count()
        context['total_employees'] = InRoom.objects.count()
        context['is_afternoon'] = is_afternoon

        return context


@method_decorator(csrf_exempt, name='dispatch')
class RecordEntryView(View):
    def post(self, request):
        try:
            data = json.loads(request.body)

            action = data.get('action')
            card_no = data.get('card_no')

            # 社員番号の検証
            if not card_no:
                return JsonResponse({
                    'status': 'error',
                    'message': 'カードが正しく読み込まれませんでした'
                }, status=400)

            # 社員を検索
            try:
                employee = Employee.objects.get(employee_number=card_no)
            except Employee.DoesNotExist:
                print(f"Employee not found for card_no: {card_no}")
                return JsonResponse({
                    'status': 'error',
                    'message': f'カードが登録されていません'
                }, status=404)

            # InRoomレコードを取得または作成
            in_room, created = InRoom.objects.get_or_create(employee=employee)

            current_time = timezone.now()

            if action == 'enter':
                result = self._handle_enter(in_room, current_time)
                return result
            elif action == 'exit':
                result = self._handle_exit(in_room)
                return result
            else:
                print(f"Invalid action: {action}")
                return JsonResponse({
                    'status': 'error',
                    'message': '無効なアクションです'
                }, status=400)

        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
            return JsonResponse({
                'status': 'error',
                'message': '無効なJSONデータです'
            }, status=400)
        except Exception as e:
            print(f"Unexpected error in RecordEntryView: {e}")
            import traceback
            print(f"Traceback: {traceback.format_exc()}")
            return JsonResponse({
                'status': 'error',
                'message': str(e)
            }, status=500)

    def _handle_enter(self, in_room, current_time):
        """入室処理"""
        if in_room.is_in_room:
            return JsonResponse({
                'status': 'error',
                'message': f'{in_room.employee.name}さんは既に入室済みです'
            }, status=400)

        in_room.in_room_time = current_time.time()
        in_room.save()

        return JsonResponse({
            'status': 'success',
            'message': f'{in_room.employee.name}さんの入室を記録しました'
        })

    def _handle_exit(self, in_room):
        """退室処理"""
        if not in_room.is_in_room:
            return JsonResponse({
                'status': 'error',
                'message': f'{in_room.employee.name}さんは入室していません'
            }, status=400)

        in_room.in_room_time = None
        in_room.save()

        return JsonResponse({
            'status': 'success',
            'message': f'{in_room.employee.name}さんの退室を記録しました'
        })
