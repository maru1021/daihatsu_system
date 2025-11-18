from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from management_room.models import MachiningItem, CastingItem, MachiningItemCastingItemMap

class MachiningItemCastingItemMapView(ManagementRoomPermissionMixin, BasicTableView):
    title = '加工品番-鋳造品番紐づけ'
    page_title = '加工品番-鋳造品番紐づけ'
    crud_model = MachiningItemCastingItemMap
    table_model = MachiningItemCastingItemMap.objects.all().order_by(
        'machining_line_name', 'machining_item_name', 'casting_line_name', 'casting_item_name'
    )
    form_dir = 'master/machining_item_casting_item_map'
    form_action_url = 'management_room:machining_item_casting_item_map'
    edit_url = 'management_room:machining_item_casting_item_map_edit'
    delete_url = 'management_room:machining_item_casting_item_map_delete'
    admin_table_header = ['加工品番', '鋳造品番', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['加工品番', '鋳造品番', 'アクティブ', '最終更新者']
    search_fields = ['machining_line_name', 'machining_item_name', 'casting_line_name', 'casting_item_name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # ライン名と品番名の組み合わせでユニークにする（distinctを使う場合はorder_byも同じフィールドにする必要がある）
        machining_items = MachiningItem.objects.select_related('line').filter(active=True)
        casting_items = CastingItem.objects.select_related('line').filter(active=True)
        context['machining_items'] = machining_items
        context['casting_items'] = casting_items
        return context

    def get_edit_data(self, data):
        try:
            # 文字列フィールドから品番IDを取得
            machining_item_id = ''
            print(data.machining_line_name, data.machining_item_name)
            if data.machining_line_name and data.machining_item_name:
                machining_item = MachiningItem.objects.filter(
                    line__name=data.machining_line_name,
                    name=data.machining_item_name,
                    active=True
                ).first()
                if machining_item:
                    machining_item_id = machining_item.id
            print(machining_item_id)

            casting_item_id = ''
            if data.casting_line_name and data.casting_item_name:
                casting_item = CastingItem.objects.filter(
                    line__name=data.casting_line_name,
                    name=data.casting_item_name,
                    active=True
                ).first()
                if casting_item:
                    casting_item_id = casting_item.id

            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'machining_item_id': machining_item_id,
                    'casting_item_id': casting_item_id,
                    'active': data.active,
                    'last_updated_user': data.last_updated_user,
                },
                'edit_url': reverse(self.edit_url, kwargs={'pk': data.id}),
            }
            print(response_data)
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

            # 品番情報を取得
            machining_item = None
            casting_item = None
            if machining_item_id:
                machining_item = MachiningItem.objects.filter(id=machining_item_id).select_related('line').first()
            if casting_item_id:
                casting_item = CastingItem.objects.filter(id=casting_item_id).select_related('line').first()

            # 重複チェック（文字列フィールドで比較）
            if active and machining_item and casting_item:
                query = self.crud_model.objects.filter(
                    machining_line_name=machining_item.line.name if machining_item.line else '',
                    machining_item_name=machining_item.name,
                    casting_line_name=casting_item.line.name if casting_item.line else '',
                    casting_item_name=casting_item.name,
                    active=True
                )
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
            # 品番情報を取得
            machining_item_id = data.get('machining_item_id', '').strip()
            casting_item_id = data.get('casting_item_id', '').strip()

            machining_item = MachiningItem.objects.filter(id=machining_item_id).select_related('line').first() if machining_item_id else None
            casting_item = CastingItem.objects.filter(id=casting_item_id).select_related('line').first() if casting_item_id else None

            return self.crud_model.objects.create(
                machining_line_name=machining_item.line.name if machining_item and machining_item.line else '',
                machining_item_name=machining_item.name if machining_item else '',
                casting_line_name=casting_item.line.name if casting_item and casting_item.line else '',
                casting_item_name=casting_item.name if casting_item else '',
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            # 品番情報を取得
            machining_item_id = data.get('machining_item_id', '').strip()
            casting_item_id = data.get('casting_item_id', '').strip()

            machining_item = MachiningItem.objects.filter(id=machining_item_id).select_related('line').first() if machining_item_id else None
            casting_item = CastingItem.objects.filter(id=casting_item_id).select_related('line').first() if casting_item_id else None

            model.machining_line_name = machining_item.line.name if machining_item and machining_item.line else ''
            model.machining_item_name = machining_item.name if machining_item else ''
            model.casting_line_name = casting_item.line.name if casting_item and casting_item.line else ''
            model.casting_item_name = casting_item.name if casting_item else ''
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
                    # 加工品番の表示形式（文字列フィールドから直接取得）
                    machining_display = ''
                    if row.machining_item_name:
                        # assembly_lineの情報は文字列フィールドにないため、MachiningItemから取得
                        machining_item = MachiningItem.objects.filter(
                            line__name=row.machining_line_name,
                            name=row.machining_item_name,
                            active=True
                        ).select_related('line').first()

                        if machining_item:
                            machining_line = machining_item.line.name if machining_item.line else ''
                            machining_name = machining_item.name
                            machining_display = f"{machining_line} - {machining_name}"
                        else:
                            machining_display = f"{row.machining_line_name} - {row.machining_item_name}"

                    # 鋳造品番の表示形式（文字列フィールドから直接取得）
                    casting_display = ''
                    if row.casting_item_name:
                        casting_display = f"{row.casting_line_name} - {row.casting_item_name}"

                    formatted_data.append({
                        'id': row.id,
                        'fields': [
                            machining_display,
                            casting_display,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                    })
            else:
                for row in page_obj:
                    # 加工品番の表示形式（文字列フィールドから直接取得）
                    machining_display = '未設定'
                    if row.machining_item_name:
                        # assembly_lineの情報は文字列フィールドにないため、MachiningItemから取得
                        machining_item = MachiningItem.objects.filter(
                            line__name=row.machining_line_name,
                            name=row.machining_item_name,
                            active=True
                        ).select_related('assembly_line', 'line').first()

                        if machining_item:
                            assembly_line = machining_item.assembly_line.name if machining_item.assembly_line else ''
                            machining_line = machining_item.line.name if machining_item.line else ''
                            machining_name = machining_item.name
                            machining_display = f"{assembly_line} - {machining_line} - {machining_name}"
                        else:
                            machining_display = f"{row.machining_line_name} - {row.machining_item_name}"

                    # 鋳造品番の表示形式（文字列フィールドから直接取得）
                    casting_display = '未設定'
                    if row.casting_item_name:
                        casting_display = f"{row.casting_line_name} - {row.casting_item_name}"

                    formatted_data.append({
                        'fields': [
                            machining_display,
                            casting_display,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
