from django.shortcuts import render, get_object_or_404
from django.views import View
from django.utils import timezone
from django.db.models import Prefetch, Sum, Q
from django.http import JsonResponse
from django.template.loader import render_to_string
from django.db import transaction
from actual_production.models import AttendanceRecord, AttendanceTask, AttendanceSupport, AttendanceSelect
from management_room.models import Employee
from manufacturing.models import Line
from datetime import datetime, date
from calendar import monthrange
import json
import re
from actual_production.auth_mixin import ActualProductionPermissionMixin

class AttendanceDisplayView(ActualProductionPermissionMixin, View):
    template_dir = 'attendance_display'

    def get(self, request, *args, **kwargs):
        try:
            is_htmx = request.headers.get('HX-Request')
            pk = kwargs.get('pk')

            # 編集時の初期値
            if pk:
                data = get_object_or_404(AttendanceRecord, pk=pk)
                response_data = self.get_edit_data(data)
                return JsonResponse(response_data)

            # HTMX要求時はコンテンツ部分のみ返す
            if is_htmx:
                context = self.get_context_data(request)
                content_template = self.template_dir + '/content.html'
                return render(request, content_template, context)

            # 通常アクセス時は完全なページを返す
            context = self.get_context_data(request)
            self.template_name = self.template_dir + '/table.html'
            return render(request, self.template_name, context)

        except Exception as e:
            print(f"Error in attendance display view: {str(e)}")
            import traceback
            traceback.print_exc()
            return JsonResponse({
                'status': 'error',
                'message': f'データの取得中にエラーが発生しました: {str(e)}'
            }, status=400)

    def get_edit_data(self, record):
        """編集時のデータを取得する"""
        # 業務内容データを整理
        tasks_data = {}
        for task in record.tasks.all():
            tasks_data[task.attendance_select.id] = {
                'hours': float(task.hours),
                'overtime': task.overtime
            }

        # 応援データを整理
        supports_data = []
        for support in record.supports.all():
            supports_data.append({
                'line_id': support.line.id,
                'hours': float(support.hours),
                'overtime': support.overtime
            })

        return {
            'employee_number': record.employee.employee_number,
            'attendance_date': record.attendance_date.strftime('%Y-%m-%d'),
            'start_time': record.start_time.strftime('%H:%M'),
            'end_time': record.end_time.strftime('%H:%M'),
            'own_line_operation_hours': float(record.own_line_operation_hours),
            'production_overtime': float(record.production_overtime),
            'tasks': tasks_data,
            'supports': supports_data
        }

    def get_context_data(self, request, selected_date=None):
        try:
            # 日付パラメータを取得（デフォルトは今日）
            if selected_date:
                target_date = selected_date
            else:
                date_param = request.GET.get('date')
                if date_param:
                    target_date = datetime.strptime(date_param, '%Y-%m-%d').date()
                else:
                    target_date = timezone.now().date()

            # ライン絞り込みパラメータを取得
            selected_line_id = request.GET.get('line_filter', '')
            selected_line_id = int(selected_line_id) if selected_line_id else None

            # 勤怠選択肢を取得（有効なもののみ、並び順でソート）
            attendance_selects = AttendanceSelect.objects.filter(active=True).order_by('order', 'name')

            # ライン情報を取得（応援編集用）
            lines = Line.objects.filter(active=True).order_by('name')

            # 指定日の勤怠データを取得（関連データも一緒に取得）
            query = AttendanceRecord.objects.filter(attendance_date=target_date)

            # ライン絞り込みが指定されている場合
            if selected_line_id:
                query = query.filter(employee__line_id=selected_line_id)

            attendance_records = query.select_related('employee', 'employee__line').prefetch_related(
                Prefetch('tasks', queryset=AttendanceTask.objects.select_related('attendance_select')),
                Prefetch('supports', queryset=AttendanceSupport.objects.select_related('line'))
            ).order_by('employee__name')

            # テーブル用のデータを準備
            table_data = []
            for record in attendance_records:
                # 各勤怠選択肢の時間を通常/残業で分離
                normal_task_hours = {}
                overtime_task_hours = {}
                for task in record.tasks.all():
                    task_id = task.attendance_select.id
                    if task.overtime:
                        overtime_task_hours[task_id] = str(task.hours)
                    else:
                        normal_task_hours[task_id] = str(task.hours)

                # 応援を通常/残業で分離
                normal_supports = []
                normal_support_lines = []
                normal_support_hours = []
                overtime_supports = []
                overtime_support_lines = []
                overtime_support_hours = []

                for support in record.supports.all():
                    line_name = support.line.name
                    support_hours = str(support.hours)
                    support_text = f"{line_name} {support_hours}"

                    if support.overtime:
                        overtime_supports.append(support_text)
                        overtime_support_lines.append(line_name)
                        overtime_support_hours.append(support_hours)
                    else:
                        normal_supports.append(support_text)
                        normal_support_lines.append(line_name)
                        normal_support_hours.append(support_hours)

                # 各勤怠選択肢に対応する列データを作成（通常/残業別）
                normal_task_columns = []
                overtime_task_columns = []
                for attendance_select in attendance_selects:
                    normal_task_columns.append(normal_task_hours.get(attendance_select.id, '-'))
                    overtime_task_columns.append(overtime_task_hours.get(attendance_select.id, '-'))

                # 通常と残業の合計を計算
                normal_total = record.own_line_operation_hours
                for support in record.supports.all():
                    if not support.overtime:
                        normal_total += support.hours
                for task in record.tasks.all():
                    if not task.overtime:
                        normal_total += task.hours

                overtime_total = record.production_overtime
                for support in record.supports.all():
                    if support.overtime:
                        overtime_total += support.hours
                for task in record.tasks.all():
                    if task.overtime:
                        overtime_total += task.hours

                table_data.append({
                    'id': record.id,
                    'employee_name': record.employee.name,
                    'employee_number': record.employee.employee_number,
                    'employee_line': record.employee.line.name if record.employee.line else '-',
                    'own_line_operation_hours': record.own_line_operation_hours,
                    'production_overtime': record.production_overtime,
                    'normal_total': normal_total,
                    'overtime_total': overtime_total,
                    'normal_task_columns': normal_task_columns,
                    'overtime_task_columns': overtime_task_columns,
                    'normal_supports': normal_supports,
                    'normal_support_lines': normal_support_lines,
                    'normal_support_hours': normal_support_hours,
                    'overtime_supports': overtime_supports,
                    'overtime_support_lines': overtime_support_lines,
                    'overtime_support_hours': overtime_support_hours,
                    'edit_url': f'/actual_production/attendance-display/{record.id}/',
                    'delete_url': f'/actual_production/attendance-display/{record.id}/delete/'
                })

            # 月間残業累積データを計算
            overtime_summary_data = self.get_overtime_summary_data(target_date, selected_line_id)

            return {
                'page_title': '勤怠データ表示',
                'table_data': table_data,
                'attendance_selects': attendance_selects,
                'lines': lines,
                'overtime_summary_data': overtime_summary_data,
                'selected_date': target_date,
                'selected_line_id': selected_line_id,
                'date_str': target_date.strftime('%Y-%m-%d'),
                'is_admin': True  # 管理者権限があると仮定
            }

        except Exception as e:
            return {
                'error_message': f'データの取得中にエラーが発生しました: {str(e)}',
                'table_data': [],
                'attendance_selects': [],
                'lines': [],
                'overtime_summary_data': [],
                'selected_date': timezone.now().date(),
                'selected_line_id': None,
                'date_str': timezone.now().date().strftime('%Y-%m-%d'),
                'is_admin': True
            }

    def get_overtime_summary_data(self, target_date, selected_line_id=None):
        """指定日の月の残業累積と年度の45時間超えカウントを取得"""
        try:
            # 月の開始日と終了日を取得
            year = target_date.year
            month = target_date.month
            month_start = date(year, month, 1)
            last_day = monthrange(year, month)[1]
            month_end = date(year, month, last_day)

            # 年度の開始日と終了日を取得（4月開始）
            if month >= 4:
                fiscal_year_start = date(year, 4, 1)
                fiscal_year_end = date(year + 1, 3, 31)
            else:
                fiscal_year_start = date(year - 1, 4, 1)
                fiscal_year_end = date(year, 3, 31)

            # 年度に勤怠データがある従業員を取得
            employees_query = Employee.objects.filter(
                attendancerecord__attendance_date__range=[fiscal_year_start, fiscal_year_end]
            )

            # ライン絞り込みが指定されている場合
            if selected_line_id:
                employees_query = employees_query.filter(line_id=selected_line_id)

            employees_with_data = employees_query.distinct().order_by('name')

            overtime_data = []
            for employee in employees_with_data:
                # 該当月の全勤怠レコードを取得
                monthly_records = AttendanceRecord.objects.filter(
                    employee=employee,
                    attendance_date__range=[month_start, month_end]
                ).prefetch_related(
                    Prefetch('tasks', queryset=AttendanceTask.objects.select_related('attendance_select')),
                    Prefetch('supports', queryset=AttendanceSupport.objects.select_related('line'))
                )

                # 年度の全勤怠レコードを取得
                yearly_records = AttendanceRecord.objects.filter(
                    employee=employee,
                    attendance_date__range=[fiscal_year_start, fiscal_year_end]
                ).prefetch_related(
                    Prefetch('tasks', queryset=AttendanceTask.objects.select_related('attendance_select')),
                    Prefetch('supports', queryset=AttendanceSupport.objects.select_related('line'))
                )

                # 月間残業時間を計算
                monthly_overtime = 0
                for record in monthly_records:
                    monthly_overtime += float(record.production_overtime)
                    for task in record.tasks.all():
                        if task.overtime:
                            monthly_overtime += float(task.hours)
                    for support in record.supports.all():
                        if support.overtime:
                            monthly_overtime += float(support.hours)

                # 年度の45時間超えカウントを計算
                over_45_count = 0
                monthly_totals = {}

                for record in yearly_records:
                    record_month = record.attendance_date.replace(day=1)
                    if record_month not in monthly_totals:
                        monthly_totals[record_month] = 0

                    monthly_totals[record_month] += float(record.production_overtime)
                    for task in record.tasks.all():
                        if task.overtime:
                            monthly_totals[record_month] += float(task.hours)
                    for support in record.supports.all():
                        if support.overtime:
                            monthly_totals[record_month] += float(support.hours)

                # 45時間を超えた月をカウント
                for month_total in monthly_totals.values():
                    if month_total > 45:
                        over_45_count += 1

                overtime_data.append({
                    'name': employee.name,
                    'monthly_overtime': monthly_overtime,
                    'over_45_count': over_45_count
                })

            return overtime_data

        except Exception as e:
            print(f"Error in get_overtime_summary_data: {str(e)}")
            return []

    def delete(self, request, *args, **kwargs):
        try:
            record = get_object_or_404(AttendanceRecord, pk=kwargs['pk'])
            employee_name = record.employee.name
            record.delete()

            # 削除後のテーブルデータを再取得
            context = self.get_context_data(request)
            html = render_to_string(self.template_dir + '/data_table.html', context, request=request)

            return JsonResponse({
                'status': 'success',
                'message': f'{employee_name}の勤怠データが正常に削除されました。',
                'html': html
            })
        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': 'データの削除中にエラーが発生しました。'
            }, status=400)

    def post(self, request, *args, **kwargs):
        """一括更新処理"""
        try:
            data = json.loads(request.body)
            changes = data.get('changes', {})
            target_date = datetime.strptime(data.get('date'), '%Y-%m-%d').date()
            selected_line_id = data.get('selected_line_id')
            print(changes)

            if not changes:
                return JsonResponse({
                    'status': 'error',
                    'message': '変更がありません。'
                })

            # 勤怠選択肢を事前に取得
            attendance_selects = list(AttendanceSelect.objects.filter(active=True).order_by('order', 'name'))

            with transaction.atomic():
                for record_id, record_changes in changes.items():
                    record = get_object_or_404(AttendanceRecord, pk=record_id)

                    # 自ライン稼働時間の更新
                    if 'own_line_operation_hours' in record_changes:
                        value = record_changes['own_line_operation_hours']
                        # 数値に変換
                        record.own_line_operation_hours = float(value) if value else 0

                    # ライン残業時間の更新
                    if 'production_overtime' in record_changes:
                        value = record_changes['production_overtime']
                        # 数値に変換
                        record.production_overtime = float(value) if value else 0

                    # レコードの保存（いずれかが更新された場合）
                    if 'own_line_operation_hours' in record_changes or 'production_overtime' in record_changes:
                        record.save()

                    # 業務内容の更新
                    for field_name, field_value in record_changes.items():
                        if field_name.startswith('normal_task_') or field_name.startswith('overtime_task_'):
                            # normal_task_0, overtime_task_1 などからインデックスを取得
                            is_overtime = field_name.startswith('overtime_task_')
                            task_index = int(field_name.replace('normal_task_', '').replace('overtime_task_', ''))

                            if task_index < len(attendance_selects):
                                attendance_select = attendance_selects[task_index]

                                # 該当する残業フラグのタスクのみ削除
                                AttendanceTask.objects.filter(
                                    attendance_record=record,
                                    attendance_select=attendance_select,
                                    overtime=is_overtime
                                ).delete()

                                # 新しい値をパース
                                if field_value and field_value != '-':
                                    try:
                                        hours = float(field_value)
                                        if hours > 0:
                                            AttendanceTask.objects.create(
                                                attendance_record=record,
                                                attendance_select=attendance_select,
                                                hours=hours,
                                                overtime=is_overtime
                                            )
                                    except ValueError:
                                        pass

                    # 応援の更新（通常）
                    if 'normal_supports' in record_changes:
                        print(f"Processing normal_supports for record {record.id}: {record_changes['normal_supports']}")
                        # 既存の通常応援データを削除
                        deleted_count = AttendanceSupport.objects.filter(attendance_record=record, overtime=False).delete()
                        print(f"Deleted {deleted_count[0]} existing normal supports")

                        # 新しい通常応援データを作成
                        supports_text = record_changes['normal_supports'].replace('<br>', '\n')
                        print(f"Supports text after processing: '{supports_text}'")
                        if supports_text and supports_text != '-':
                            for support_line in supports_text.split('\n'):
                                support_line = support_line.strip()
                                print(f"Processing support line: '{support_line}'")
                                if support_line:
                                    line_name, hours, overtime = self.parse_support_value(support_line)
                                    print(f"Parsed: line_name='{line_name}', hours={hours}, overtime={overtime}")
                                    if line_name and hours > 0:
                                        try:
                                            line = Line.objects.get(name=line_name, active=True)
                                            support = AttendanceSupport.objects.create(
                                                attendance_record=record,
                                                line=line,
                                                hours=hours,
                                                overtime=False
                                            )
                                            print(f"Created support: {support}")
                                        except Line.DoesNotExist:
                                            print(f"Line not found: {line_name}")
                                            pass  # ライン名が見つからない場合はスキップ

                    # 応援の更新（残業）
                    if 'overtime_supports' in record_changes:
                        # 既存の残業応援データを削除
                        AttendanceSupport.objects.filter(attendance_record=record, overtime=True).delete()

                        # 新しい残業応援データを作成
                        supports_text = record_changes['overtime_supports'].replace('<br>', '\n')
                        if supports_text and supports_text != '-':
                            for support_line in supports_text.split('\n'):
                                support_line = support_line.strip()
                                if support_line:
                                    line_name, hours, overtime = self.parse_support_value(support_line)
                                    if line_name and hours > 0:
                                        try:
                                            line = Line.objects.get(name=line_name, active=True)
                                            AttendanceSupport.objects.create(
                                                attendance_record=record,
                                                line=line,
                                                hours=hours,
                                                overtime=True
                                            )
                                        except Line.DoesNotExist:
                                            pass  # ライン名が見つからない場合はスキップ

            # 更新後のテーブルデータを取得（編集した日付で）
            # 一時的にGETパラメータにライン情報を設定
            if selected_line_id:
                request.GET = request.GET.copy()
                request.GET['line_filter'] = str(selected_line_id)
            updated_context = self.get_context_data(request, selected_date=target_date)

            return JsonResponse({
                'status': 'success',
                'message': '勤怠データが正常に更新されました。',
                'table_data': updated_context['table_data'],
                'attendance_selects': [{'id': sel.id, 'name': sel.name} for sel in updated_context['attendance_selects']],
                'lines': [{'id': line.id, 'name': line.name} for line in updated_context['lines']],
                'selected_date': target_date.strftime('%Y-%m-%d'),
                'overtime_summary_data': updated_context['overtime_summary_data']
            })

        except Exception as e:
            print(f"Error in bulk update: {str(e)}")
            import traceback
            traceback.print_exc()
            return JsonResponse({
                'status': 'error',
                'message': f'更新中にエラーが発生しました: {str(e)}'
            }, status=400)

    def parse_task_value(self, value):
        """業務内容の値をパース（例: "3", "2 (残業)" → (時間, 残業フラグ)）"""
        if not value or value == '-':
            return 0, False

        # 残業チェック
        overtime = '残業' in value

        # 時間の抽出
        try:
            # 残業表記を除去して数値に変換
            hours_str = value.replace(' (残業)', '').strip()
            hours = float(hours_str) if hours_str else 0
        except ValueError:
            hours = 0

        return hours, overtime

    def parse_support_value(self, value):
        """応援の値をパース（例: "1ヘッド 2 (残業)" → (ライン名, 時間, 残業フラグ)）"""
        if not value or value == '-':
            return None, 0, False

        # 残業チェック
        overtime = '残業' in value

        # 最後の数値（時間）を抽出
        hours_match = re.search(r'([0-9.]+)(?:\s*\(残業\))?$', value)
        hours = float(hours_match.group(1)) if hours_match else 0

        # ライン名の抽出（最後の空白+数値+残業表記を除去）
        if hours_match:
            # 最後の数値とその前の空白、および残業表記を除去
            line_name = value[:hours_match.start()].strip()
        else:
            line_name = value.strip()

        print(f"Parse debug: value='{value}' -> line_name='{line_name}', hours={hours}, overtime={overtime}")
        return line_name, hours, overtime
