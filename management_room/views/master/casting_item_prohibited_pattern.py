from django.urls import reverse
from django.db.models import Q
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from manufacturing.models import CastingLine
from management_room.models import CastingItem, CastingItemProhibitedPattern

class CastingItemProhibitedPatternView(ManagementRoomPermissionMixin, BasicTableView):
    title = '鋳造品番禁止パターン'
    page_title = '鋳造品番禁止パターン管理'
    crud_model = CastingItemProhibitedPattern
    table_model = CastingItemProhibitedPattern.objects.select_related(
        'line', 'item_name1', 'item_name2'
    ).only(
        'id', 'line', 'item_name1', 'item_name2', 'count', 'active', 'last_updated_user'
    )
    form_dir = 'master/casting_item_prohibited_pattern'
    form_action_url = 'management_room:casting_item_prohibited_pattern'
    edit_url = 'management_room:casting_item_prohibited_pattern_edit'
    delete_url = 'management_room:casting_item_prohibited_pattern_delete'
    admin_table_header = ['ライン', '品番1', '品番2', '同時生産上限', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['ライン', '品番1', '品番2', '同時生産上限', 'アクティブ', '最終更新者']
    search_fields = ['line__name', 'item_name1__name', 'item_name2__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        lines = CastingLine.objects.filter(active=True).order_by('name')
        casting_items = CastingItem.objects.select_related('line').filter(active=True).order_by('line__name', 'name')
        context['lines'] = lines
        context['casting_items'] = casting_items
        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'line_id': data.line.id if data.line else '',
                    'item_name1_id': data.item_name1.id if data.item_name1 else '',
                    'item_name2_id': data.item_name2.id if data.item_name2 else '',
                    'count': data.count if data.count else 2,
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
            item_name1_id = data.get('item_name1_id', '').strip()
            item_name2_id = data.get('item_name2_id', '').strip()
            count = data.get('count', '').strip()
            active = data.get('active') == 'on'

            # 必須チェック
            if not line_id:
                errors['line_id'] = '鋳造ラインは必須です。'
            if not item_name1_id:
                errors['item_name1_id'] = '品番1は必須です。'
            if not count:
                errors['count'] = '同時生産上限は必須です。'
            else:
                try:
                    count_int = int(count)
                    if count_int < 1:
                        errors['count'] = '同時生産上限は1以上である必要があります。'
                except ValueError:
                    errors['count'] = '同時生産上限は数値である必要があります。'

            # 同じ品番のチェック（品番2が指定されている場合のみ）
            if item_name1_id and item_name2_id and item_name1_id == item_name2_id:
                errors['item_name2_id'] = '品番1と品番2は異なる品番を選択してください。'

            # 重複チェック（同じ組み合わせが既に存在するか）
            if active and line_id and item_name1_id:
                if item_name2_id:
                    # 品番2がある場合：品番1と品番2の順序に関わらずチェック
                    query = self.crud_model.objects.filter(
                        line_id=line_id,
                        active=True
                    ).filter(
                        Q(item_name1_id=item_name1_id, item_name2_id=item_name2_id) |
                        Q(item_name1_id=item_name2_id, item_name2_id=item_name1_id)
                    )
                else:
                    # 品番2がない場合：品番1のみでチェック
                    query = self.crud_model.objects.filter(
                        line_id=line_id,
                        item_name1_id=item_name1_id,
                        item_name2_id__isnull=True,
                        active=True
                    )

                if pk:
                    query = query.exclude(id=pk)
                if query.exists():
                    errors['item_name1_id'] = 'この品番の組み合わせは既に登録されています。'
                    if item_name2_id:
                        errors['item_name2_id'] = 'この品番の組み合わせは既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return {'error': 'バリデーションエラーが発生しました。'}

    def create_model(self, data, user, files=None):
        try:
            line_id = data.get('line_id', '').strip()
            item_name1_id = data.get('item_name1_id', '').strip()
            item_name2_id = data.get('item_name2_id', '').strip()
            count = int(data.get('count', 0))

            return self.crud_model.objects.create(
                line_id=line_id if line_id else None,
                item_name1_id=item_name1_id if item_name1_id else None,
                item_name2_id=item_name2_id if item_name2_id else None,
                count=count,
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            line_id = data.get('line_id', '').strip()
            item_name1_id = data.get('item_name1_id', '').strip()
            item_name2_id = data.get('item_name2_id', '').strip()
            count = int(data.get('count', 2))

            model.line_id = line_id if line_id else None
            model.item_name1_id = item_name1_id if item_name1_id else None
            model.item_name2_id = item_name2_id if item_name2_id else None
            model.count = count
            model.active = data.get('active') == 'on'
            model.last_updated_user = user.username if user else None
            model.save()

            return None
        except Exception as e:
            except_output('Update model error', e)
            raise Exception(e)

    def format_data(self, page_obj, is_admin=True):
        try:
            formatted_data = []
            for row in page_obj:

                if is_admin:
                    formatted_data.append({
                        'id': row.id,
                        'fields': [
                            row.line.name if row.line else '',
                            row.item_name1.name if row.item_name1 else '',
                            row.item_name2.name if row.item_name2 else '',
                            row.count,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                    })
                else:
                    formatted_data.append({
                        'fields': [
                            row.line.name if row.line else '',
                            row.item_name1.name if row.item_name1 else '',
                            row.item_name2.name if row.item_name2 else '',
                            row.count,
                            '有効' if row.active else '無効',
                            row.last_updated_user if row.last_updated_user else ''
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
