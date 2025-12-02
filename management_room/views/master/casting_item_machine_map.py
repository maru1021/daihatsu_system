from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from management_room.models import CastingItem, CastingItemMachineMap
from manufacturing.models import CastingLine, CastingMachine

class CastingItemMachineMapView(ManagementRoomPermissionMixin, BasicTableView):
    title = '鋳造品番-設備紐づけ'
    page_title = '鋳造品番-設備紐づけ'
    crud_model = CastingItemMachineMap
    table_model = CastingItemMachineMap.objects.select_related('line', 'machine', 'casting_item').only(
        'id', 'line', 'machine', 'casting_item', 'tact', 'yield_rate', 'active', 'last_updated_user'
    ).order_by('line__order', 'machine__order', 'casting_item__order')
    form_dir = 'master/casting_item_machine_map'
    form_action_url = 'management_room:casting_item_machine_map'
    edit_url = 'management_room:casting_item_machine_map_edit'
    delete_url = 'management_room:casting_item_machine_map_delete'
    admin_table_header = ['鋳造ライン', '鋳造機', '鋳造品番', 'タクト', '良品率', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['鋳造ライン', '鋳造機', '鋳造品番', 'タクト', '良品率', 'アクティブ', '最終更新者']
    search_fields = ['line__name', 'machine__name', 'casting_item__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        lines = CastingLine.objects.filter(active=True).order_by('order')
        machines = CastingMachine.objects.select_related('line').filter(active=True).order_by('line__order', 'order')
        casting_items = CastingItem.objects.select_related('line').filter(active=True).order_by('line__order', 'order')
        context['lines'] = lines
        context['machines'] = machines
        context['casting_items'] = casting_items
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'line_id': data.line.id if data.line else '',
                    'machine_id': data.machine.id if data.machine else '',
                    'casting_item_id': data.casting_item.id if data.casting_item else '',
                    'tact': data.tact if data.tact else 0,
                    'yield_rate': data.yield_rate * 100 if data.yield_rate else 0,
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
            line_id = data.get('line_id', '').strip()
            machine_id = data.get('machine_id', '').strip()
            casting_item_id = data.get('casting_item_id', '').strip()
            active = data.get('active') == 'on'

            if not line_id:
                errors['line_id'] = '鋳造ラインは必須です。'
            if not machine_id:
                errors['machine_id'] = '鋳造機は必須です。'
            if not casting_item_id:
                errors['casting_item_id'] = '鋳造品番は必須です。'

            # 重複チェック
            if active and line_id and machine_id and casting_item_id:
                query = self.crud_model.objects.filter(
                    line_id=line_id,
                    machine_id=machine_id,
                    casting_item_id=casting_item_id,
                    active=True
                )
                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['line_id'] = 'この組み合わせは既に登録されています。'
                    errors['machine_id'] = 'この組み合わせは既に登録されています。'
                    errors['casting_item_id'] = 'この組み合わせは既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                line_id=data.get('line_id', '').strip(),
                machine_id=data.get('machine_id', '').strip(),
                casting_item_id=data.get('casting_item_id', '').strip(),
                tact=data.get('tact', 0) or 0,
                yield_rate=float(data.get('yield_rate', 0))/100 or 0,
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.line = CastingLine.objects.get(id=data.get('line_id', '').strip()) if data.get('line_id', '').strip() else None
            model.machine = CastingMachine.objects.get(id=data.get('machine_id', '').strip()) if data.get('machine_id', '').strip() else None
            model.casting_item = CastingItem.objects.get(id=data.get('casting_item_id', '').strip()) if data.get('casting_item_id', '').strip() else None
            model.tact = data.get('tact', 0) or 0
            model.yield_rate = float(data.get('yield_rate', 0))/100 or 0
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
                    # 鋳造ラインの表示形式
                    line_display = row.line.name if row.line else ''

                    # 鋳造機の表示形式
                    machine_display = row.machine.name if row.machine else ''

                    # 鋳造品番の表示形式
                    casting_display = ''
                    if row.casting_item:
                        casting_line = row.casting_item.line.name if row.casting_item.line else ''
                        casting_name = row.casting_item.name
                        casting_display = f"{casting_line} - {casting_name}"

                    formatted_data.append({
                        'id': row.id,
                        'fields': [
                            line_display,
                            machine_display,
                            casting_display,
                            row.tact if row.tact else 0,
                            row.yield_rate *100 if row.yield_rate else 0,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                    })
            else:
                for row in page_obj:
                    # 鋳造ラインの表示形式
                    line_display = row.line.name if row.line else ''

                    # 鋳造機の表示形式
                    machine_display = row.machine.name if row.machine else ''

                    # 鋳造品番の表示形式
                    casting_display = '未設定'
                    if row.casting_item:
                        casting_line = row.casting_item.line.name if row.casting_item.line else ''
                        casting_name = row.casting_item.name
                        casting_display = f"{casting_line} - {casting_name}"

                    formatted_data.append({
                        'fields': [
                            line_display,
                            machine_display,
                            casting_display,
                            row.tact if row.tact else 0,
                            row.yield_rate * 100 if row.yield_rate else 0,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
