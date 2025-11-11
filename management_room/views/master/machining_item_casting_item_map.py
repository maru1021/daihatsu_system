from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from management_room.models import MachiningItem, CastingItem, MachiningItemCastingItemMap

class MachiningItemCastingItemMapView(ManagementRoomPermissionMixin, BasicTableView):
    title = '加工品番-鋳造品番紐づけ'
    page_title = '加工品番-鋳造品番紐づけ'
    crud_model = MachiningItemCastingItemMap
    table_model = MachiningItemCastingItemMap.objects.select_related('machining_item', 'casting_item').only(
        'id', 'machining_item', 'casting_item', 'active', 'last_updated_user'
    )
    form_dir = 'master/machining_item_casting_item_map'
    form_action_url = 'management_room:machining_item_casting_item_map'
    edit_url = 'management_room:machining_item_casting_item_map_edit'
    delete_url = 'management_room:machining_item_casting_item_map_delete'
    admin_table_header = ['加工品番', '鋳造品番', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['加工品番', '鋳造品番', 'アクティブ', '最終更新者']
    search_fields = ['machining_item__name', 'casting_item__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        machining_items = MachiningItem.objects.select_related('line').filter(active=True).order_by('name')
        casting_items = CastingItem.objects.select_related('line').filter(active=True).order_by('name')
        context['machining_items'] = machining_items
        context['casting_items'] = casting_items
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'machining_item_id': data.machining_item.id if data.machining_item else '',
                    'casting_item_id': data.casting_item.id if data.casting_item else '',
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
            machining_item_id = data.get('machining_item_id', '').strip()
            casting_item_id = data.get('casting_item_id', '').strip()
            active = data.get('active') == 'on'

            if not machining_item_id:
                errors['machining_item_id'] = '加工品番は必須です。'
            if not casting_item_id:
                errors['casting_item_id'] = '鋳造品番は必須です。'

            # 重複チェック
            if active:
                query = self.crud_model.objects.filter(machining_item_id=machining_item_id, casting_item_id=casting_item_id, active=True)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['machining_item_id'] = 'この品番の組み合わせは既に登録されています。'
                    errors['casting_item_id'] = 'この品番の組み合わせは既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                machining_item_id=data.get('machining_item_id', '').strip(),
                casting_item_id=data.get('casting_item_id', '').strip(),
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.machining_item = MachiningItem.objects.get(id=data.get('machining_item_id', '').strip()) if data.get('machining_item_id', '').strip() else None
            model.casting_item = CastingItem.objects.get(id=data.get('casting_item_id', '').strip()) if data.get('casting_item_id', '').strip() else None
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
                            row.machining_item.name if row.machining_item else '未設定',
                            row.casting_item.name if row.casting_item else '未設定',
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
                            row.machining_item.name if row.machining_item else '未設定',
                            row.casting_item.name if row.casting_item else '未設定',
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
