from management_room.models import Department, Employee, DepartmentEmployee
from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from daihatsu.models import CustomUser
from django.utils.safestring import mark_safe
from django.utils import timezone
from manufacturing.models import Line

class EmployeeMasterView(ManagementRoomPermissionMixin, BasicTableView):
    title = '従業員'
    page_title = '従業員管理'
    crud_model = Employee
    table_model = Employee.objects.prefetch_related('department_employee__department', 'line').only(
        'id', 'name', 'employee_number', 'email', 'phone_number', 'last_updated_user', 'line__name'
    )
    form_dir = 'master/employee'
    form_action_url = 'management_room:employee_master'
    edit_url = 'management_room:employee_edit'
    delete_url = 'management_room:employee_delete'
    admin_table_header = ['部署', '従業員番号', '従業員名', 'メールアドレス', '内線番号', 'ライン', '最終更新者', '操作']
    user_table_header = ['部署', '従業員番号', '従業員名', 'メールアドレス', '内線番号', 'ライン', '最終更新者']
    search_fields = ['department_employee__department__name', 'employee_number', 'name',  'email', 'phone_number', 'line__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # 編集時は非アクティブな部署も含めて取得
        if 'pk' in kwargs:
            departments = Department.objects.all().order_by('name')
            lines = Line.objects.all().order_by('name')
        else:
            departments = Department.objects.filter(active=True).order_by('name')
            lines = Line.objects.filter(active=True).order_by('name')
        context['lines'] = lines
        context['departments'] = departments
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                  'id': data.id,
                  'name': data.name,
                  'department[]': [{'id': dept.department.id, 'name': dept.department.name} for dept in data.department_employee.filter(leave_date__isnull=True)],
                  'line': data.line.id if data.line else '',
                  'employee_number': data.employee_number,
                  'email': data.email,
                  'phone_number': data.phone_number,
              },
              'edit_url': reverse(self.edit_url, kwargs={'pk': data.id}),
            }
            return response_data
        except Exception as e:
            except_output('Get edit data error', e)
            return {
                'status': 'error',
                'message': 'データの取得に失敗しました。'
            }

    def validate_data(self, data, pk=None):
        try:
            errors = {}
            name = data.get('name', '').strip()
            employee_number = data.get('employee_number', '').strip()

            if not name:
                errors['name'] = '従業員名は必須です。'

            if not employee_number:
                errors['employee_number'] = '従業員番号は必須です。'
            else:
                query = self.crud_model.objects.filter(employee_number=employee_number)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['employee_number'] = 'この従業員番号は既に使用されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def extra_registar(self, request, model, action):
        department_ids = request.POST.getlist('department[]')
        # 文字列を整数に変換
        department_ids = [int(dept_id) for dept_id in department_ids if dept_id]

        if model and action == 'create':
            # 新規作成時
            for department_id in department_ids:
                DepartmentEmployee.objects.create(
                    employee_id=model.id,
                    department_id=department_id,

                )
        elif model and action == 'update':
            # 編集時 - オブジェクトを取得
            department_employees = DepartmentEmployee.objects.filter(employee_id=model.id, leave_date__isnull=True)
            existing_dept_ids = list(department_employees.values_list('department_id', flat=True))

            # 削除すべき部署を退職扱いにする
            for dept_employee in department_employees:
                if dept_employee.department_id not in department_ids:
                    dept_employee.leave_date = timezone.now().date()
                    dept_employee.save()

            # 新しく追加すべき部署
            for department_id in department_ids:
                if department_id not in existing_dept_ids:
                    DepartmentEmployee.objects.create(
                        employee_id=model.id,
                        department_id=department_id,
                        transfer_date=timezone.now().date()
                    )
        return

    def create_model(self, data, user, files=None):
        try:
            add_user = CustomUser.objects.create_user(
                username=data.get('employee_number', '').strip(),
                password="password",
            )

            return self.crud_model.objects.create(
                user=add_user,
                name=data.get('name', '').strip(),
                employee_number=data.get('employee_number', '').strip(),
                email=data.get('email', '').strip(),
                phone_number=data.get('phone_number', '').strip(),
                line=Line.objects.get(id=data.get('line', '').strip()) if data.get('line', '').strip() else None,
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.name = data.get('name').strip()
            model.employee_number = data.get('employee_number').strip()
            model.email = data.get('email').strip()
            model.phone_number = data.get('phone_number').strip()
            line_id = data.get('line', '').strip()
            model.line = Line.objects.get(id=line_id) if line_id else None
            model.last_updated_user = user.username if user else None
            model.save()

            return None
        except Exception as e:
            except_output('Update model error', e)
            raise Exception(e)

    # テーブルに返すデータの整形
    def format_data(self, page_obj, is_admin=True):
        try:
            formatted_data = []
            if is_admin:
                for row in page_obj:
                    # 部署名を取得（department_employeeを経由）
                    department_names = '<br>'.join([f'{dept_emp.department.name}' for dept_emp in row.department_employee.filter(leave_date__isnull=True)])
                    formatted_data.append({
                        'id': row.id,
                        'fields': [
                            mark_safe(department_names),
                            row.employee_number,
                            row.name,
                            row.email,
                            row.phone_number,
                            row.line.name if row.line else '',
                            row.last_updated_user if row.last_updated_user else '',
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                        'name': row.name,
                    })
            else:
                for row in page_obj:
                    # 部署名を取得（department_employeeを経由）
                    department_names = '<br>'.join([f'{dept_emp.department.name}' for dept_emp in row.department_employee.filter(leave_date__isnull=True)])
                    formatted_data.append({
                        'fields': [
                            mark_safe(department_names),
                            row.employee_number,
                            row.name,
                            row.email,
                            row.phone_number,
                            row.line.name if row.line else '',
                            row.last_updated_user if row.last_updated_user else '',
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
