from actual_production.models import AttendanceSelect
from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output

class AttendanceSelectMasterView(ManagementRoomPermissionMixin, BasicTableView):
    title = '勤怠選択'
    page_title = '勤怠選択管理'
    crud_model = AttendanceSelect
    table_model = AttendanceSelect.objects.only(
        'id', 'name', 'active', 'last_updated_user'
    )
    form_dir = 'master/attendance_select'
    form_action_url = 'actual_production:attendance_select_master'
    edit_url = 'actual_production:attendance_select_edit'
    delete_url = 'actual_production:attendance_select_delete'
    admin_table_header = ['勤怠選択肢', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['勤怠選択肢', 'アクティブ', '最終更新者']
    search_fields = ['name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                  'id': data.id,
                  'name': data.name,
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

            if not name:
                errors['name'] = '勤怠選択肢は必須です。'
            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                name=data.get('name', '').strip(),
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.name = data.get('name').strip()
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
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                        'name': row.name,
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row.name,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
