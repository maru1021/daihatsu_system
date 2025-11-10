from actual_production.models import ActualProductionItem
from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output

class ActualProductionItemMasterView(ManagementRoomPermissionMixin, BasicTableView):
    title = '実績生産品目'
    page_title = '実績生産品目管理'
    crud_model = ActualProductionItem
    table_model = ActualProductionItem.objects.only(
        'id', 'code', 'name', 'active', 'last_updated_user'
    )
    form_dir = 'master/actual_production_item'
    form_action_url = 'actual_production:actual_production_item_master'
    edit_url = 'actual_production:actual_production_item_edit'
    delete_url = 'actual_production:actual_production_item_delete'
    admin_table_header = ['コード', '実績生産品目名', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['コード', '実績生産品目名', 'アクティブ', '最終更新者']
    search_fields = ['code', 'name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        actual_production_items = ActualProductionItem.objects.filter(active=True).order_by('name')
        context['actual_production_items'] = actual_production_items
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                  'id': data.id,
                  'code': data.code,
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
            code = data.get('code', '').strip()

            if not name:
                errors['name'] = '実績生産品目名は必須です。'
            if active:
                query = self.crud_model.objects.filter(name=name, active=True)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['name'] = 'この実績生産品目名は既に使用されています。'

            if not code:
                errors['code'] = '実績生産品目コードは必須です。'
            if active:
                query = self.crud_model.objects.filter(code=code, active=True)
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['code'] = 'この実績生産品目コードは既に使用されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                code=data.get('code', '').strip(),
                name=data.get('name', '').strip(),
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.code = data.get('code').strip()
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
                            row.code,
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
                            row.code,
                            row.name,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
