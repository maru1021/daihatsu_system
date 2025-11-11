from django.urls import reverse

from daihatsu.except_output import except_output
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.views.excel_operation_view import ExcelOperationView
from daihatsu.views.PDFcreate import PDFGenerator
from manufacturing.auth_mixin import ManufacturingPermissionMixin
from manufacturing.models import AssemblyLine


class AssemblyLineView(ManufacturingPermissionMixin, BasicTableView):
    title = '組付ライン'
    page_title = '組付ライン管理'
    crud_model = AssemblyLine
    table_model = AssemblyLine.objects.only(
        'id', 'name', 'occupancy_rate', 'tact', 'yield_rate', 'active', 'last_updated_user'
    )
    form_dir = 'master/assembly_line'
    form_action_url = 'manufacturing:assembly_line_master'
    edit_url = 'manufacturing:assembly_line_edit'
    delete_url = 'manufacturing:assembly_line_delete'
    excel_export_url = 'manufacturing:assembly_line_export_excel'
    excel_import_url = 'manufacturing:assembly_line_import_excel'
    pdf_export_url = 'manufacturing:assembly_line_export_pdf'
    admin_table_header = ['ライン名', '稼働率', 'タクト', '良品率', 'アクティブ', '最終更新者', '操作']
    user_table_header = ['ライン名', '稼働率', 'タクト', '良品率', 'アクティブ']
    search_fields = ['name']

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'name': data.name,
                    'occupancy_rate': data.occupancy_rate * 100,
                    'tact': data.tact,
                    'yield_rate': data.yield_rate * 100,
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
            name = data.get('name').strip()
            active = data.get('active') == 'on'
            if not name:
                errors['name'] = 'ライン名は必須です。'

            if active:
                if self.crud_model.validate_name_unique(name, pk):
                    errors['name'] = f'{str(self.crud_model.get_by_name(name))}は既に登録されています。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            raise Exception(e)

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                name=data.get('name').strip(),
                occupancy_rate=float(data.get('occupancy_rate')) / 100 if data.get('occupancy_rate') else 0,
                tact=float(data.get('tact')) if data.get('tact') else 0,
                yield_rate=float(data.get('yield_rate')) / 100 if data.get('yield_rate') else 0,
                active=data.get('active') == 'on',
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.name = data.get('name').strip()
            model.occupancy_rate = float(data.get('occupancy_rate')) / 100 if data.get('occupancy_rate') else 0
            model.tact = float(data.get('tact')) if data.get('tact') else 0
            model.yield_rate = float(data.get('yield_rate')) / 100 if data.get('yield_rate') else 0
            model.active = data.get('active') == 'on'
            model.last_updated_user = user.username if user else None
            model.save()

            return None
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
                            row.name,
                            float(row.occupancy_rate) * 100,
                            row.tact,
                            float(row.yield_rate) * 100,
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
                            row.name,
                            float(row.occupancy_rate) * 100,
                            row.tact,
                            float(row.yield_rate) * 100,
                            '有効' if row.active else '無効'
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)


class AssemblyLineExcelView(ManufacturingPermissionMixin, ExcelOperationView):
    export_model = AssemblyLine.objects.values('id', 'name', 'occupancy_rate', 'active')
    import_model = AssemblyLine
    excel_file_name = 'line_master.xlsx'
    table_class = AssemblyLineView

    def set_excel_file(self, models):
        data_list = [
            {
                '操作': '',
                'ID': model['id'],
                'ライン名': model['name'],
                '稼働率': float(model['occupancy_rate']) * 100,
                'タクト': model['tact'],
                '良品率': float(model['yield_rate']) * 100,
                'アクティブ': '有効' if model['active'] else '無効'
            } for model in models
        ]

        return data_list

    def validate_data(self, index, row, id):
        try:
            name_value = row.get('ライン名')
            name = str(name_value).strip() if name_value is not None else ''
            if not name:
                return f'{index}行目: ライン名は必須です。'

            if row.get('アクティブ') != '無効':
                if self.import_model.validate_name_unique(name, id):
                    return f'{index}行目: {name}は既に登録されています。'

            return None
        except Exception as e:
            except_output('Validate data error', e)
            return f'{index}行目: データの検証に失敗しました。'

    def model_create(self, create_list, user):
        try:
            create_objects = [
                self.import_model(
                    name=str(row.get('ライン名')).strip(),
                    occupancy_rate=float(row.get('稼働率')) / 100 if row.get('稼働率') else 0,
                    tact=float(row.get('タクト')) if row.get('タクト') else 0,
                    yield_rate=float(row.get('良品率')) / 100 if row.get('良品率') else 0,
                    active=row.get('アクティブ') != '無効',
                    last_updated_user=user.username if user else None
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
                obj.name = str(row['ライン名']).strip()
                obj.occupancy_rate = float(row.get('稼働率')) / 100 if row.get('稼働率') else 0
                obj.tact = float(row.get('タクト')) if row.get('タクト') else 0
                obj.yield_rate = float(row.get('良品率')) / 100 if row.get('良品率') else 0
                obj.active = row.get('アクティブ') != '無効'
                obj.last_updated_user = user.username if user else None
                update_objects.append(obj)

            self.import_model.objects.bulk_update(
                update_objects,
                ['name', 'tact', 'occupancy_rate', 'active', 'last_updated_user']
            )
            return len(update_objects)
        except Exception as e:
            except_output('Model update error', e)
            raise Exception(e)


class AssemblyLinePDFView(ManufacturingPermissionMixin, PDFGenerator):
    title = 'ライン一覧'
    data = AssemblyLine.objects.all()
    headers = ['ID', 'ライン名', '稼働率', 'タクト', '良品率', 'アクティブ', '最終更新者', '作成日時', '更新日時']
    file_name = 'line_master.pdf'

    def _format_data(self, data):
        """データのフォーマット"""
        return [
            str(data.id),
            str(data.name),
            str(data.occupancy_rate * 100),
            str(data.tact),
            str(data.yield_rate * 100),
            '有効' if data.active else '無効',
            data.last_updated_user if data.last_updated_user else '',
        ]
