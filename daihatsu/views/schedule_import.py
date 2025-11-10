from django.views import View
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import json
import re

from management_room.models import Employee
from in_room.models import Schedule, InRoom
from daihatsu.except_output import except_output

@method_decorator(csrf_exempt, name='dispatch')
class ScheduleImport(View):
    def post(self, request):
        try:
            # リクエストボディからJSONデータを取得
            data = json.loads(request.body.decode('utf-8'))

            mail = data.get('mail')

            try:
                employee = Employee.objects.get(email=mail)
            except Employee.DoesNotExist:
                return JsonResponse({
                    'status': 'error',
                    'message': 'emailが間違えています'
                }, status=400)

            # 各データを個別に表示してUnicodeエスケープを回避
            schedules = data.get('data', [])
            for schedule in schedules:
                title = schedule.get('title')
                start_time = schedule.get('start_time')
                end_time = schedule.get('end_time')
                organize = schedule.get('organize')

                Schedule.objects.create(
                        employee=employee,
                        title=title,
                        start_time=start_time,
                        end_time=end_time
                    )
                if (start_time != "00:00") & (end_time != "00:00"):
                    continue

                try:
                    organize_address = schedule.get('organize_address')
                    organize = Employee.objects.get(email=organize_address)
                    match = re.match(r'^(.*?)[:：]', title)
                    title = match.group(1).strip() if match else title

                    if organize.departments.filter(name__in=["管理室", "技術課", "品質課"]).exists() and InRoom.objects.filter(employee=organize).exists():
                        inroom_model = InRoom.objects.get(employee=organize)
                        if title == "年休":
                            inroom_model.annual_leave = True
                            inroom_model.save()
                        elif title == "午前休":
                            inroom_model.morning_annual_leave = True
                            inroom_model.save()
                        elif title == "午後休":
                            inroom_model.afternoon_annual_leave = True
                            inroom_model.save()
                        elif title == "出張":
                            inroom_model.business_trip = True
                            inroom_model.save()
                    elif organize.departments.filter(name__in=["管理室", "技術課", "品質課"]).exists():
                        if title == "年休":
                            InRoom.objects.create(
                                employee = organize,
                                annual_leave = True
                            )
                        elif title == "午前休":
                            InRoom.objects.create(
                                employee = organize,
                                morning_annual_leave = True
                            )
                        elif title == "午後休":
                            InRoom.objects.create(
                                employee = organize,
                                afternoon_annual_leave = True
                            )
                        elif title == "出張":
                            InRoom.objects.create(
                                employee = organize,
                                business_trip = True
                            )


                except Exception as e:
                    except_output('ScheduleImport error', e)

            return JsonResponse({
                'status': 'success',
                'message': 'スケジュールデータを正常に受信しました',
            }, status=200)

        except json.JSONDecodeError as e:
            except_output('ScheduleImport error', e)
            return JsonResponse({
                'status': 'error',
                'message': 'JSONデータの解析に失敗しました'
            }, status=400)

        except Exception as e:
            except_output('ScheduleImport error', e)
            return JsonResponse({
                'status': 'error',
                'message': 'データ処理中にエラーが発生しました'
            }, status=500)
