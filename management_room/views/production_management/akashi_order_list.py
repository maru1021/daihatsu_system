from management_room.models import AkashiOrderList
from django.urls import reverse
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.basic_table_view import BasicTableView
from daihatsu.except_output import except_output
from django.utils.safestring import mark_safe
import fitz  # PyMuPDF
from daihatsu.views.pdf_operation_view import PDFOperationView


class AkashiOderListView(ManagementRoomPermissionMixin, BasicTableView):
    title = '明石発注データリスト'
    page_title = '明石発注データリスト'
    crud_model = AkashiOrderList
    table_model = AkashiOrderList.objects.only(
        'id', 'no', 'data_classification', 'order_classification', 'delivery_number', 'acceptance', 'jersey_number', 'product_number',
        'delivery_date', 'flight', 'capacity', 'box_quantity', 'quantity', 'last_updated_user'
    )
    form_dir = 'production_management/akashi_order_list'
    form_action_url = 'management_room:akashi_order_list'
    edit_url = 'management_room:akashi_order_list_edit'
    delete_url = 'management_room:akashi_order_list_delete'
    admin_table_header = ['No', 'データ区分', '発注区分', '納番', '受入', '背番号', '品番', '納入日', '便', '収容数', '箱数', '数量', '最終更新者', '操作']
    user_table_header = ['No', 'データ区分', '発注区分', '納番', '受入', '背番号', '品番', '納入日', '便', '収容数', '箱数', '数量', '最終更新者']
    search_fields = ['data_classification', 'order_classification', 'product_number', 'delivery_date', 'jersey_number',
                     'acceptance', 'flight']
    pdf_import_url = 'management_room:akashi_order_list_import_pdf'

    def get_edit_data(self, data):
        try:
            response_data = {
                'status': 'success',
                'data': {
                    'id': data.id,
                    'no': data.no,
                    'data_classification': data.data_classification if data.data_classification else '',
                    'order_classification': data.order_classification if data.order_classification else '',
                    'delivery_number': data.delivery_number if data.delivery_number else '',
                    'acceptance': data.acceptance if data.acceptance else '',
                    'jersey_number': data.jersey_number if data.jersey_number else '',
                    'product_number': data.product_number if data.product_number else '',
                    'delivery_date': data.delivery_date if data.delivery_date else '',
                    'flight': data.flight if data.flight else '',
                    'capacity': data.capacity if data.capacity else '',
                    'box_quantity': data.box_quantity if data.box_quantity else '',
                    'quantity': data.quantity if data.quantity else '',
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
            delivery_date = data.get('delivery_date', '').strip()

            if not delivery_date:
                errors['delivery_date'] = '納入日は必須です。'

            return errors
        except Exception as e:
            except_output('Validate data error', e)
            return True

    def create_model(self, data, user, files=None):
        try:
            return self.crud_model.objects.create(
                no=data.get('no', '').strip(),
                data_classification=data.get('data_classification', '').strip(),
                order_classification=data.get('order_classification', '').strip(),
                delivery_number=data.get('delivery_number', '').strip(),
                acceptance=data.get('acceptance', '').strip(),
                jersey_number=data.get('jersey_number', '').strip(),
                product_number=data.get('product_number', '').strip(),
                delivery_date=data.get('delivery_date', '').strip(),
                flight=data.get('flight', '').strip(),
                capacity=data.get('capacity', '').strip(),
                box_quantity=data.get('box_quantity', '').strip(),
                quantity=data.get('quantity', '').strip(),
                last_updated_user=user.username if user else None,
            )
        except Exception as e:
            except_output('Create model error', e)
            raise Exception(e)

    def update_model(self, model, data, user, files=None):
        try:
            model.no = data.get('no').strip()
            model.data_classification = data.get('data_classification').strip()
            model.order_classification = data.get('order_classification').strip() if data.get('order_classification') else None
            model.delivery_number = data.get('delivery_number').strip()
            model.acceptance = data.get('acceptance').strip() if data.get('acceptance') else None
            model.jersey_number = data.get('jersey_number').strip() if data.get('jersey_number') else None
            model.product_number = data.get('product_number').strip()
            model.delivery_date = data.get('delivery_date').strip() if data.get('delivery_date') else None
            model.flight = data.get('flight').strip() if data.get('flight') else None
            model.capacity = data.get('capacity').strip() if data.get('capacity') else None
            model.box_quantity = data.get('box_quantity').strip() if data.get('box_quantity') else None
            model.quantity = data.get('quantity').strip() if data.get('quantity') else None
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
                            row.no if row.no else '',
                            row.data_classification if row.data_classification else '',
                            row.order_classification if row.order_classification else '',
                            row.delivery_number if row.delivery_number else '',
                            row.acceptance if row.acceptance else '',
                            row.jersey_number if row.jersey_number else '',
                            row.product_number if row.product_number else '',
                            row.delivery_date if row.delivery_date else '',
                            row.flight if row.flight else '',
                            row.capacity if row.capacity else '',
                            row.box_quantity if row.box_quantity else '',
                            row.quantity if row.quantity else '',
                            row.last_updated_user if row.last_updated_user else '',
                        ],
                        'edit_url': reverse(self.edit_url, kwargs={'pk': row.id}),
                        'delete_url': reverse(self.delete_url, kwargs={'pk': row.id}),
                        'name': row.no if row.no else '',
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row.no if row.no else '',
                            row.data_classification if row.data_classification else '',
                            row.order_classification if row.order_classification else '',
                            row.delivery_number if row.delivery_number else '',
                            row.acceptance if row.acceptance else '',
                            row.jersey_number if row.jersey_number else '',
                            row.product_number if row.product_number else '',
                            row.delivery_date if row.delivery_date else '',
                            row.flight if row.flight else '',
                            row.capacity if row.capacity else '',
                            row.box_quantity if row.box_quantity else '',
                            row.quantity if row.quantity else '',
                            row.last_updated_user if row.last_updated_user else '',
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)


class AkashiOrderPDFImportView(PDFOperationView):
    """明石発注データリストのPDFインポート"""
    import_model = AkashiOrderList
    table_class = AkashiOderListView

    # PDFのヘッダー定義（実際のPDFに合わせて調整）
    PDF_HEADERS = [
        'No', 'データ区分', '発注区分', '納番', '受入',
        '背番号', '品番', '工程', '納入日', '便',
        '収容数', '箱数', '数量'
    ]

    """数字で始まる行をデータ行とする"""
    def is_data_row(self, line):
        """
        データ行かどうかを判定

        Args:
            line: 判定する行

        Returns:
            bool: データ行の場合True
        """
        if not line:
            return False

        # ページ番号行を除外（例: "1/1 ページ"）
        if line.endswith('ページ'):
            return False

        # 数字で始まる行をデータ行として判定
        return line[0].isdigit()

    def extract_table_data(self, text):
        """
        テキストから表データを抽出

        Args:
            text: PDFから抽出した生テキスト

        Returns:
            list: データ行を空白で分割したリストのリスト
        """
        if '----' not in text:
            return []

        # 区切り線で分割して後半部分を取得
        table_section = text.split('----', 1)[1]

        # データ行のみをフィルタリングして、空白で分割
        data_rows = []
        for line in table_section.split('\n'):
            if self.is_data_row(line.strip()):
                row = line.strip().split()
                data_rows.append(row)

        return data_rows

    def extract_pdf_data(self, pdf_file):
        """PDFファイルから表データを抽出"""
        try:
            extracted_data = []

            # PyMuPDFでPDFを開く
            doc = fitz.open(stream=pdf_file.read(), filetype="pdf")

            # 各ページからデータを抽出
            for page in doc:
                data_lines = self.extract_table_data(page.get_text())

                # データ行を辞書形式に変換
                for data_row in data_lines:
                    print(data_row)
                    row_dict = {}

                    # ヘッダーとデータをマッピング
                    for i, header in enumerate(self.PDF_HEADERS):
                        if i < len(data_row):
                            row_dict[header] = data_row[i]
                        else:
                            row_dict[header] = ''

                    extracted_data.append(row_dict)

            return extracted_data
        except Exception as e:
            except_output('PDF extraction error', e)
            raise Exception(f'PDFデータ抽出エラー: {str(e)}')

    def parse_date(self, date_str):
        """
        日付文字列を変換 (例: "25/10/14" -> "2025-10-14")

        Args:
            date_str: 日付文字列 (YY/MM/DD形式)

        Returns:
            str: YYYY-MM-DD形式の日付文字列、または None
        """
        if not date_str:
            return None

        try:
            parts = date_str.split('/')
            if len(parts) == 3:
                year = '20' + parts[0]  # 25 -> 2025
                month = parts[1].zfill(2)  # 10 -> 10
                day = parts[2].zfill(2)  # 14 -> 14
                return f'{year}-{month}-{day}'
        except:
            return None

        return None

    def model_create(self, data_list, user):
        """データを一括作成"""
        try:
            success_count = 0

            for row_data in data_list:
                try:
                    # ヘッダー名とモデルフィールド名のマッピング
                    no_value = row_data.get('No', '').strip().rstrip('.')  # "1." -> "1"
                    data_classification_value = row_data.get('データ区分', '').strip()
                    order_classification_value = row_data.get('発注区分', '').strip()
                    delivery_number_value = row_data.get('納番', '').strip()  # 文字列 (例: "K0100")
                    acceptance_value = row_data.get('受入', '').strip()
                    jersey_number_value = row_data.get('背番号', '').strip()
                    product_number_value = row_data.get('品番', '').strip()
                    delivery_date_value = row_data.get('納入日', '').strip()  # "25/10/14"
                    flight_value = row_data.get('便', '').strip()
                    capacity_value = row_data.get('収容数', '').strip()
                    box_quantity_value = row_data.get('箱数', '').strip()
                    quantity_value = row_data.get('数量', '').strip()

                    # 納入日を変換
                    parsed_date = self.parse_date(delivery_date_value)

                    AkashiOrderList.objects.create(
                        no=int(no_value) if no_value else None,
                        data_classification=data_classification_value or None,
                        order_classification=int(order_classification_value) if order_classification_value else None,
                        delivery_number=delivery_number_value or None,  # 文字列として保存
                        acceptance=int(acceptance_value) if acceptance_value else None,
                        jersey_number=int(jersey_number_value) if jersey_number_value else None,
                        product_number=product_number_value or None,
                        delivery_date=parsed_date,  # 変換後の日付
                        flight=int(flight_value) if flight_value else None,
                        capacity=int(capacity_value) if capacity_value else None,
                        box_quantity=int(box_quantity_value) if box_quantity_value else None,
                        quantity=int(quantity_value) if quantity_value else None,
                        last_updated_user=user.username if user else None,
                    )
                    success_count += 1
                except Exception as row_error:
                    except_output(f'Row create error', row_error)
                    continue

            return success_count
        except Exception as e:
            except_output('Model create error', e)
            raise Exception(str(e))
