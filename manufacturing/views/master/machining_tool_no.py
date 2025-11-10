from manufacturing.models import MachiningLine, MachiningMachine, MachiningToolNo
from django.urls import reverse
from manufacturing.auth_mixin import ManufacturingPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from daihatsu.views.excel_operation_view import ExcelOperationView

class MachiningToolNoView(ManufacturingPermissionMixin, BasicTableView):
    title = 'ツールNo'
    page_title = 'ツールNo管理'
    crud_model = MachiningToolNo
    table_model = MachiningToolNo.objects.select_related('line', 'machine').only(
        'id', 'line__name', 'machine__name', 'name', 'active', 'last_updated_user'
    )
    form_dir = 'master/machining_tool_no'
    form_action_url = 'manufacturing:machining_tool_no_master'
    edit_url = 'manufacturing:machining_tool_no_edit'
    delete_url = 'manufacturing:machining_tool_no_delete'
    excel_export_url = 'manufacturing:machining_tool_no_export_excel'
    excel_import_url = 'manufacturing:machining_tool_no_import_excel'
    admin_table_header = ['ライン名', '加工機名', 'ツールNo', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['ライン名', '加工機名', 'ツールNo', 'アクティブ']
    search_fields = ['name', 'line__name', 'machine__name']

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['lines'] = MachiningLine.get_active_names()
        context['machines'] = MachiningMachine.get_active_names()

        return context

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'line_id': data.line.id if data.line else None,
                    'line_name': data.line.name if data.line else None,
                    'machine_id': data.machine.id if data.machine else None,
                    'machine_name': data.machine.name if data.machine else None,
                    'id': data.id,
                    'tool_no': data.name,
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
            name = data.get('tool_no').strip()
            line = MachiningLine.get_by_id(data.get('line_id')) if data.get('line_id') else None
            machine = MachiningMachine.get_by_id(data.get('machine_id')) if data.get('machine_id') else None

            if not line:
                errors['line_id'] = 'ラインを選択してください。'

            if not machine:
                errors['machine_id'] = '加工機を選択してください。'

            if not name:
                errors['tool_no'] = 'ツールNoは必須です。'

            if data.get('active') == 'on':
                if self.crud_model.validate_name_unique(machine, name, pk):
                    errors['tool_no'] = f'{line.name} - {machine.name} - {name}は既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                line_id=data.get('line_id'),
                machine_id=data.get('machine_id'),
                name=data.get('tool_no', '').strip(),
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.line_id = data.get('line_id')
            model.machine_id = data.get('machine_id')
            model.name = data.get('tool_no', '').strip()
            model.active = data.get('active') == 'on'
            model.last_updated_user = user.username if user else None
            model.save()
        except Exception as e:
            except_output('Update model error', e)
            raise Exception(e)

    def format_data(self, page_obj, is_admin):
        try:
            formatted_data = []
            if is_admin:
                for row in page_obj:
                    formatted_data.append({
                        'id': row.id,
                        'fields': [
                            row.line.name,
                            row.machine.name,
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
                            row.line.name if row.line else '未設定',
                            row.machine.name if row.machine else '未設定',
                            row.name,
                            '有効' if row.active else '無効'
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)

class MachingToolNoExcelView(ManufacturingPermissionMixin, ExcelOperationView):
    export_model = MachiningToolNo.objects.select_related('line', 'machine').values(
        'id', 'line__name', 'machine__name', 'name', 'active')
    import_model = MachiningToolNo
    excel_file_name = 'tool_no_master.xlsx'
    table_class = MachiningToolNoView

    def set_excel_file(self, models):
        data_list = [
            {
                '操作': '',
                'ID': model['id'],
                'ライン名': model['line__name'],
                '加工機名': model['machine__name'],
                'ツールNo': model['name'],
                'アクティブ': '有効' if model['active'] else '無効'
            } for model in models
        ]

        return data_list

    def extra_select(self, select_list):
        line_names = MachiningLine.get_active_names(model=False)
        machine_names = MachiningMachine.get_active_names(model=False)
        select_list.extend([
            {'column': 'C', 'select_list': line_names},
            {'column': 'D', 'select_list': machine_names},
        ])

    def validate_data(self, index, row, id):
        try:
            line_name = row.get('ライン名').strip()
            if not line_name:
                return f'{index}行目: ラインを選択してください。'
            else:
                line = MachiningLine.get_by_name(line_name)
                if not line:
                    return f'{index}行目: ライン名: {line_name} が登録されていません。'

            machine_name = row.get('加工機名').strip()
            if not machine_name:
                return f'{index}行目: 加工機を選択してください。'
            else:
                machine = MachiningMachine.get_by_name(line, machine_name)
                if not machine:
                    return f'{index}行目: 加工機名: {line.name}-{machine_name} が登録されていません。'

            tool_no = str(row.get('ツールNo')).strip()
            if not tool_no:
                return f'{index}行目: ツールNoは必須です。'

            if row.get('アクティブ') != '無効':
                if self.import_model.validate_name_unique(machine, tool_no, id):
                    return f'{index}行目: {line.name} - {machine.name} - {tool_no}は既に登録されています。'

            return None
        except Exception as e:
            except_output('Validate data error', e)
            return f'{index}行目: データの検証に失敗しました。'

    def model_create(self, create_list, user):
        try:
            create_objects = [
                self.import_model(
                    line=MachiningLine.cache_get_by_name(row['ライン名']),
                    machine=MachiningMachine.cache_get_by_name(MachiningLine.cache_get_by_name(row['ライン名']), row['加工機名']),
                    name=str(row['ツールNo']).strip(),
                    active=row['アクティブ'] != '無効',
                    last_updated_user=user.username if user else None,
                ) for row in create_list
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
                obj.line = MachiningLine.cache_get_by_name(row['ライン名'])
                obj.machine = MachiningMachine.cache_get_by_name(MachiningLine.cache_get_by_name(row['ライン名']), row['加工機名'])
                obj.name = str(row['ツールNo']).strip()
                obj.active = row['アクティブ'] != '無効'
                obj.last_updated_user = user.username if user else None
                update_objects.append(obj)

            self.import_model.objects.bulk_update(update_objects, fields=['line', 'machine', 'name', 'active', 'last_updated_user'])

            return len(update_objects)
        except Exception as e:
            except_output('Model update error', e)
            raise Exception(e)
