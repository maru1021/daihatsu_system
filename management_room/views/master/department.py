from management_room.models import Department, Employee
from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output

class DepartmentMasterView(ManagementRoomPermissionMixin, BasicTableView):
    title = '部署'
    page_title = '部署管理'
    crud_model = Department
    table_model = Department.objects.select_related('parent', 'manager').only(
        'id', 'name', 'code', 'parent__name', 'manager__name', 'active', 'last_updated_user'
    )
    form_dir = 'master/department'
    form_action_url = 'management_room:department_master'
    edit_url = 'management_room:department_edit'
    delete_url = 'management_room:department_delete'
    admin_table_header = ['部署名', 'コード', '親部署', '部署長', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['部署名', 'コード', '親部署', '部署長', 'アクティブ', '最終更新者']
    search_fields = ['name', 'code', 'parent__name', 'manager__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        departments = Department.objects.filter(active=True).order_by('name')
        employees = Employee.objects.all().order_by('name')
        context['departments'] = departments
        context['employees'] = employees
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                  'id': data.id,
                  'name': data.name,
                  'code': data.code,
                  'parent': data.parent.id if data.parent else '',
                  'manager': data.manager.id if data.manager else '',
                  'active': data.active
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
            active = data.get('active') == 'on'
            code = data.get('code', '').strip()

            if not name:
                errors['name'] = '部署名は必須です。'
            if active:
                query = self.crud_model.objects.filter(name=name, active=True)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['name'] = 'この部署名は既に使用されています。'

            if not code:
                errors['code'] = '部署コードは必須です。'
            if active:
                query = self.crud_model.objects.filter(code=code, active=True)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['code'] = 'この部署コードは既に使用されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                name=data.get('name', '').strip(),
                code=data.get('code', '').strip(),
                parent=self.crud_model.objects.get(id=data.get('parent', None)) if data.get('parent', None) else None,
                manager=Employee.objects.get(id=data.get('manager', None)) if data.get('manager', None) else None,
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            parent = Department.objects.get(id=data.get('parent', None)) if data.get('parent', None) else None
            manager = Employee.objects.get(id=data.get('manager', None)) if data.get('manager', None) else None

            model.name = data.get('name').strip()
            model.code = data.get('code').strip()
            model.parent = parent
            model.manager = manager
            model.active = data.get('active') == 'on'
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
                    formatted_data.append({
                        'id': row.id,
                        'fields': [
                            row.name,
                            row.code,
                            row.parent.name if row.parent else '',
                            row.manager.name if row.manager else '',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'parent': row.parent.id if row.parent else '',
                        'manager': row.manager.id if row.manager else '',
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                        'name': row.name,
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row.name,
                            row.code,
                            row.parent.name if row.parent else '',
                            row.manager.name if row.manager else '',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'parent': row.parent.id if row.parent else '',
                        'manager': row.manager.id if row.manager else '',
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
