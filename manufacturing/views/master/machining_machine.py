from manufacturing.models import MachiningMachine, MachiningLine
from django.urls import reverse
from manufacturing.auth_mixin import ManufacturingPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from daihatsu.views.excel_operation_view import ExcelOperationView

class MachiningMachineView(ManufacturingPermissionMixin, BasicTableView):
    title = '設備'
    page_title = '設備管理'
    crud_model = MachiningMachine
    table_model = MachiningMachine.objects.select_related('line').only(
        'id', 'line__name', 'name', 'active', 'last_updated_user'
    )
    form_dir = 'master/machining_machine'
    form_action_url = 'manufacturing:machining_machine_master'
    edit_url = 'manufacturing:machining_machine_edit'
    delete_url = 'manufacturing:machining_machine_delete'
    excel_export_url = 'manufacturing:machining_machine_export_excel'
    excel_import_url = 'manufacturing:machining_machine_import_excel'

    admin_table_header = ['ライン名', '設備名', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['ライン名', '設備名', 'アクティブ']
    search_fields = ['name', 'line__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['lines'] = MachiningLine.get_active_names()

        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'line_id': data.line.id if data.line else None,
                    'line_name': data.line.name if data.line else '未設定',
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
            line = MachiningLine.get_by_id(data.get('line_id', '')) if data.get('line_id', '') else None

            if not line:
                errors['line_id'] = 'ラインを選択してください。'
            if not name:
                errors['name'] = '設備名は必須です。'
            if active:
                if self.crud_model.validate_name_unique(line, name, pk):
                    errors['name'] = f'{name}は既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                line_id=data.get('line_id'),
                name=data.get('name', '').strip(),
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.line_id = data.get('line_id')
            model.name = data.get('name').strip()
            model.active = data.get('active') == 'on'
            model.last_updated_user = user.username if user else None
            model.save()
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
                            row.line.name,
                            row.name,
                            '有効' if row.active else '無効',
                            row.last_updated_user
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                        'name': row.name,
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row.line.name,
                            row.name,
                            '有効' if row.active else '無効'
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)


class MachiningMachineExcelView(ManufacturingPermissionMixin, ExcelOperationView):
    export_model = MachiningMachine.objects.select_related('line').values(
        'id', 'line__name', 'name', 'active')
    import_model = MachiningMachine
    excel_file_name = 'machine_master.xlsx'
    table_class =  MachiningMachineView

    def set_excel_file(self, models):
        data_list = [
            {
                '操作': '',
                'ID': model['id'],
                'ライン名': model['line__name'],
                '設備名': model['name'],
                'アクティブ': '有効' if model['active'] else '無効'
            } for model in models
        ]

        return data_list

    def extra_select(self, select_list):
        line_names = MachiningLine.get_active_names(model=False)

        select_list.append({
            'column': 'C',
            'select_list': line_names
        })

        return None

    def validate_data(self, index, row, operation='追加'):
        try:
            line_name = row.get('ライン名').strip()
            if not line_name:
                return f'{index}行目: ライン名は必須です。'
            else:
                line = MachiningLine.get_by_name(line_name)
                if not line:
                    return f'{index}行目: ライン名: {line_name} が登録されていません。'

            name = row.get('設備名').strip()
            if not name:
                return f'{index}行目: 設備名は必須です。'

            if row.get('アクティブ') != '無効':
                id = row.get('ID') if operation == '編集' else None
                if self.import_model.validate_name_unique(line, name, id):
                    return f'{index}行目: {line.name} - {name}は既に登録されています。'

            return None
        except Exception as e:
            except_output('Validate data error', e)

    def model_create(self, create_list, user):
        try:
            create_objects = [
                self.import_model(
                    line=MachiningLine.cache_get_by_name(row['ライン名']),
                    name=row['設備名'],
                    active=row['アクティブ'] != '無効',
                    last_updated_user=user.username if user else None,
                )
                for row in create_list
            ]
            self.import_model.objects.bulk_create(create_objects)

            return len(create_objects)
        except Exception as e:
            except_output('Model create error', e)
            raise Exception(e)

    def model_update(self, update_list, update_models_dict, user):
        try:
            update_objects = []
            for row in update_list:
                obj_id = int(row['ID'])
                obj = update_models_dict[obj_id]
                obj.line = MachiningLine.cache_get_by_name(row.get('ライン名'))
                obj.name = row['設備名']
                obj.active = row['アクティブ'] != '無効'
                obj.last_updated_user = user.username if user else None
                update_objects.append(obj)

            self.import_model.objects.bulk_update(update_objects, fields=['line', 'name', 'active', 'last_updated_user'])

            return len(update_objects)
        except Exception as e:
            except_output('Model update error', e)
            raise Exception(e)
