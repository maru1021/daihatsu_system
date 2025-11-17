from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from management_room.models import AssemblyItem, MachiningItem, AssemblyItemMachiningItemMap

class AssemblyItemMachiningItemMapView(ManagementRoomPermissionMixin, BasicTableView):
    title = '完成品番-加工品番紐づけ'
    page_title = '完成品番管理-加工品番紐づけ'
    crud_model = AssemblyItemMachiningItemMap
    table_model = AssemblyItemMachiningItemMap.objects.select_related('machining_item__line').only(
        'id', 'assembly_item', 'machining_item', 'active', 'last_updated_user'
    ).order_by('machining_item__assembly_line__order', 'machining_item__line__order')
    form_dir = 'master/assembly_item_machining_item_map'
    form_action_url = 'management_room:assembly_item_machining_item_map'
    edit_url = 'management_room:assembly_item_machining_item_map_edit'
    delete_url = 'management_room:assembly_item_machining_item_map_delete'
    admin_table_header = ['完成品番', '加工品番', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['完成品番', '加工品番', 'アクティブ', '最終更新者']
    search_fields = ['assembly_item__line__name', 'assembly_item__name', 'machining_item__line__name', 'machining_item__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        assembly_items = AssemblyItem.objects.select_related('line').filter(active=True).order_by('order')
        machining_items = MachiningItem.objects.select_related('line__assembly').filter(active=True).order_by('assembly_line__order','order')
        context['assembly_items'] = assembly_items
        context['machining_items'] = machining_items
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'assembly_item_id': data.assembly_item.id if data.assembly_item else '',
                    'machining_item_id': data.machining_item.id if data.machining_item else '',
                    'active': data.active,
                    'last_updated_user': data.last_updated_user,
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
            assembly_item_id = data.get('assembly_item_id', '').strip()
            machining_item_id = data.get('machining_item_id', '').strip()
            active = data.get('active') == 'on'

            if not assembly_item_id:
                errors['assembly_item_id'] = '完成品番は必須です。'
            if not machining_item_id:
                errors['machining_item_id'] = '加工品番は必須です。'

            # 重複チェック
            if active:
                query = self.crud_model.objects.filter(assembly_item_id=assembly_item_id, machining_item_id=machining_item_id, active=True)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['assembly_item_id'] = 'この品番の組み合わせは既に登録されています。'
                    errors['machining_item_id'] = 'この品番の組み合わせは既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                assembly_item_id=data.get('assembly_item_id', '').strip(),
                machining_item_id=data.get('machining_item_id', '').strip(),
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.assembly_item = AssemblyItem.objects.get(id=data.get('assembly_item_id', '').strip()) if data.get('assembly_item_id', '').strip() else None
            model.machining_item = MachiningItem.objects.get(id=data.get('machining_item_id', '').strip()) if data.get('machining_item_id', '').strip() else None
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
                    if row.machining_item.assembly_line:
                        assembly_line_name = row.machining_item.assembly_line.name
                    else:
                        assembly_line_name = ''
                    formatted_data.append({
                        'id': row.id,
                        'fields': [
                            f"{row.assembly_item.line.name} - {row.assembly_item.name}" if row.assembly_item else '',
                            f"{ assembly_line_name} - {row.machining_item.line.name} - {row.machining_item.name}" if row.machining_item else '',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            f"{row.assembly_item.line.name} - {row.assembly_item.name}" if row.assembly_item else '未設定',
                            f"{row.machining_item.line.name} - {row.machining_item.name}" if row.machining_item else '未設定',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
