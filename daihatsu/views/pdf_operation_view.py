import os
from django.db import transaction
from django.http import JsonResponse
from django.views import View

from daihatsu.except_output import except_output


# PDF操作を行うViewの基底クラス
class PDFOperationView(View):
    """PDF操作を行うViewの基底クラス"""
    import_model = None
    table_class = None

    def extract_pdf_data(self, pdf_file):
        """PDFファイルからデータを抽出する（サブクラスで実装）"""
        pass

    def validate_data(self, index, row, pk=None):
        """データのバリデーション（サブクラスで実装）"""
        return None

    def model_create(self, data, user):
        """モデルを作成する（サブクラスで実装）"""
        pass

    def post(self, request, *args, **kwargs):
        try:
            # アップロードされたファイルを取得
            uploaded_file = request.FILES.get('pdf_file')
            if not uploaded_file:
                return JsonResponse({'status': 'error', 'message': 'ファイルがアップロードされていません。'})

            # ファイルサイズ制限（20MB）
            max_size = 20 * 1024 * 1024  # 20MB
            if uploaded_file.size > max_size:
                return JsonResponse({'status': 'error', 'message': 'ファイルサイズが20MBを超えています。'})

            # ファイル拡張子の検証
            allowed_extensions = ['.pdf']
            file_extension = uploaded_file.name.lower().split('.')[-1] if '.' in uploaded_file.name else ''
            if f'.{file_extension}' not in allowed_extensions:
                return JsonResponse({'status': 'error', 'message': 'PDFファイル（.pdf）のみアップロード可能です。'})

            # Content-Typeの検証
            allowed_content_types = [
                'application/pdf',
                'application/octet-stream'
            ]
            if uploaded_file.content_type not in allowed_content_types:
                return JsonResponse({'status': 'error', 'message': '不正なファイル形式です。'})

            # PDFファイルを読み込み
            try:
                extracted_data = self.extract_pdf_data(uploaded_file)
                if not extracted_data:
                    return JsonResponse({'status': 'error', 'message': 'PDFからデータを抽出できませんでした。'})
            except Exception as pdf_error:
                except_output('PDF file read error', pdf_error)
                return JsonResponse({'status': 'error', 'message': 'PDFファイルの読み込みに失敗しました。ファイルが破損しているか、読み取れない形式の可能性があります。'})

            # トランザクション内で処理を実行
            with transaction.atomic():
                results = []
                user = request.user

                # データを検証して保存
                try:
                    success_count = self.model_create(extracted_data, user)
                    results.append(f'追加成功: {success_count}件')
                except Exception as e:
                    except_output('Model create error', e)
                    results.append(f'追加失敗: {str(e)}')

            # データベースの変更を確実にコミット
            transaction.commit()

            # table_classのインスタンスを作成してget_context_dataを取得
            table_instance = self.table_class()
            table_instance.request = request
            context = table_instance.get_context_data()

            return JsonResponse({
                'status': 'success',
                'message': 'PDFファイルの処理が完了しました。',
                'results': results,
                'table_data': context.get('data', [])
            })

        except Exception as e:
            except_output('Import PDF error', e)
            return JsonResponse({'status': 'error', 'message': 'ファイルの処理中にエラーが発生しました。'})
