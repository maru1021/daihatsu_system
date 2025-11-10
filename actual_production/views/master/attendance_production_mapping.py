from actual_production.models import AttendanceProductionMapping, AttendanceSelect, ActualProductionItem
from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output

class AttendanceProductionMappingMasterView(ManagementRoomPermissionMixin, BasicTableView):
    title = '勤怠選択肢-実績生産品目紐づけ'
    page_title = '勤怠選択肢-実績生産品目紐づけ管理'
    crud_model = AttendanceProductionMapping
    table_model = AttendanceProductionMapping.objects.select_related(
        'attendance_select', 'actual_production_item'
    ).only(
        'id', 'attendance_select__name', 'actual_production_item__code',
        'actual_production_item__name', 'active', 'last_updated_user'
    )
    form_dir = 'master/attendance_production_mapping'
    form_action_url = 'actual_production:attendance_production_mapping_master'
    edit_url = 'actual_production:attendance_production_mapping_edit'
    delete_url = 'actual_production:attendance_production_mapping_delete'
    admin_table_header = ['勤怠選択肢', '実績生産品目コード', '実績生産品目名', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['勤怠選択肢', '実績生産品目コード', '実績生産品目名', 'アクティブ', '最終更新者']
    search_fields = ['attendance_select__name', 'actual_production_item__code', 'actual_production_item__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        attendance_selects = AttendanceSelect.objects.filter(active=True).order_by('order', 'name')
        actual_production_items = ActualProductionItem.objects.filter(active=True).order_by('code', 'name')
        context['attendance_selects'] = attendance_selects
        context['actual_production_items'] = actual_production_items
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                  'id': data.id,
                  'attendance_select': data.attendance_select.id if data.attendance_select else '',
                  'actual_production_item': data.actual_production_item.id if data.actual_production_item else '',
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
            attendance_select_id = data.get('attendance_select', '')
            actual_production_item_id = data.get('actual_production_item', '')
            active = data.get('active') == 'on'

            if not attendance_select_id:
                errors['attendance_select'] = '勤怠選択肢は必須です。'
            else:
                try:
                    AttendanceSelect.objects.get(id=attendance_select_id)
                except AttendanceSelect.DoesNotExist:
                    errors['attendance_select'] = '指定された勤怠選択肢が見つかりません。'

            if not actual_production_item_id:
                errors['actual_production_item'] = '実績生産品目は必須です。'
            else:
                try:
                    ActualProductionItem.objects.get(id=actual_production_item_id)
                except ActualProductionItem.DoesNotExist:
                    errors['actual_production_item'] = '指定された実績生産品目が見つかりません。'

            # 重複チェック
            if attendance_select_id and actual_production_item_id:
                query = self.crud_model.objects.filter(
                    attendance_select_id=attendance_select_id,
                    actual_production_item_id=actual_production_item_id
                )
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['attendance_select'] = 'この組み合わせは既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            attendance_select = AttendanceSelect.objects.get(id=data.get('attendance_select'))
            actual_production_item = ActualProductionItem.objects.get(id=data.get('actual_production_item'))
            return self.crud_model.objects.create(
                attendance_select=attendance_select,
                actual_production_item=actual_production_item,
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            attendance_select = AttendanceSelect.objects.get(id=data.get('attendance_select'))
            actual_production_item = ActualProductionItem.objects.get(id=data.get('actual_production_item'))
            model.attendance_select = attendance_select
            model.actual_production_item = actual_production_item
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
                            row.attendance_select.name if row.attendance_select else '',
                            row.actual_production_item.code if row.actual_production_item else '',
                            row.actual_production_item.name if row.actual_production_item else '',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                        'name': f"{row.attendance_select.name} - {row.actual_production_item.name}",
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row.attendance_select.name if row.attendance_select else '',
                            row.actual_production_item.code if row.actual_production_item else '',
                            row.actual_production_item.name if row.actual_production_item else '',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
