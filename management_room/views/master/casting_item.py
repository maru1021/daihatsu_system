from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from management_room.models import CastingItem
from manufacturing.models import CastingLine, CastingMachine

class CastingItemMasterView(ManagementRoomPermissionMixin, BasicTableView):
    title = '鋳造品番'
    page_title = '鋳造品番管理'
    crud_model = CastingItem
    table_model = CastingItem.objects.select_related('line').only(
        'id', 'line__name', 'name', 'optimal_inventory', 'active', 'last_updated_user'
    )
    form_dir = 'master/casting_item'
    form_action_url = 'management_room:casting_item_master'
    edit_url = 'management_room:casting_item_edit'
    delete_url = 'management_room:casting_item_delete'
    admin_table_header = ['ライン名', '品番', '適正在庫', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['ライン名', '品番', '適正在庫', 'アクティブ', '最終更新者']
    search_fields = ['line__name', 'name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        lines = CastingLine.objects.filter(active=True)
        context['lines'] = lines
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'name': data.name,
                    'line_id': data.line.id if data.line else '',
                    'order': data.order,
                    'optimal_inventory': data.optimal_inventory,
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
            name = data.get('name', '').strip()
            active = data.get('active') == 'on'
            line_id = data.get('line_id', '').strip()

            if not line_id:
                errors['line'] = 'ラインは必須です。'
            if not name:
                errors['name'] = '品番は必須です。'

            # 重複チェック
            if active:
                query = self.crud_model.objects.filter(line_id=line_id, name=name, active=True)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['name'] = 'この品番は既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                name=data.get('name', '').strip(),
                line=CastingLine.objects.get(id=data.get('line_id', '').strip()) if data.get('line_id', '').strip() else None,
                optimal_inventory=data.get('optimal_inventory', '').strip() if data.get('optimal_inventory', '').strip() else 0,
                order=data.get('order') if data.get('order') else 0,
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.name = data.get('name').strip()
            model.line = CastingLine.objects.get(id=data.get('line_id', '').strip()) if data.get('line_id', '').strip() else None
            model.optimal_inventory = data.get('optimal_inventory', '').strip() if data.get('optimal_inventory', '').strip() else 0
            model.order = data.get('order') if data.get('order') else 0
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
                            row.line.name if row.line else '',
                            row.name,
                            row.optimal_inventory if row.optimal_inventory else '',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'line': row.line.id if row.line else '',
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                        'name': row.name,
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row.line.name if row.line else '',
                            row.name,
                            row.optimal_inventory if row.optimal_inventory else '',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'line': row.line.id if row.line else '',
                        'machine': row.machine.id if row.machine else '',
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
