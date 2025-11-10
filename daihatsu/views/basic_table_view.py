from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.shortcuts import render
from django.template.loader import render_to_string
from django.views.generic import TemplateView
from django.urls import reverse
from django.db.models import Q
from django.core.paginator import Paginator
import json

from daihatsu.except_output import except_output


class BasicTableView(TemplateView):
    title = None
    page_title = None
    crud_model = None
    table_model = None
    template_dir = 'template_pages/table'
    form_dir = None
    form_action_url = None
    edit_url = None
    delete_url = None
    add_button_text = '新規追加'
    excel_export_url = None
    excel_import_url = None
    pdf_export_url = None
    pdf_import_url = None
    admin_table_header = []
    user_table_header = []
    search_fields = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.noti_text = self.crud_model._meta.verbose_name

    def get_edit_data(self, data):
        """編集時のデータを取得する"""
        pass

    def validate_data(self, data, pk=None):
        """データのバリデーションを行う"""
        return {}

    def create_model(self, data, user, files=None):
        """モデルを作成する"""
        pass

    def update_model(self, model, data, user, files=None):
        """モデルを更新する"""
        pass

    def get(self, request, *args, **kwargs):
        try:
            is_htmx = request.headers.get('HX-Request')
            has_search_param = 'search' in request.GET
            has_page = request.GET.get('page') is not None
            pk = kwargs.get('pk')

            # 編集時の初期値
            if pk:
                data = get_object_or_404(self.crud_model, pk=pk)
                response_data = self.get_edit_data(data)
                return JsonResponse(response_data)

            # 検索やページネーション時
            elif is_htmx and (has_search_param or has_page):
                context = self.get_context_data(**kwargs)
                table_template = self.template_dir + '/table.html'
                return render(request, table_template, context)

            # 通常アクセス時
            elif is_htmx:
                context = self.get_context_data(**kwargs)
                content_template = self.template_dir + '/content.html'
                return render(request, content_template, context)

            # リロード時など
            self.template_name = self.template_dir + '/full_page.html'
            return super().get(request, *args, **kwargs)
        except Exception as e:
            except_output('Get error', e)
            return JsonResponse({
              'status': 'error',
              'message': 'データの取得中にエラーが発生しました。'
            }, status=400)

    # テーブルに返すデータの整形
    def format_data(self, page_obj, is_admin):
        pass

    def get_search_query(self, search_query):
        """検索クエリを生成する"""
        query = Q()
        for field in self.search_fields:
            query |= Q(**{f"{field}__icontains": search_query})
        return query

    def get_context_data(self, **kwargs):
        try:
            context = super().get_context_data(**kwargs)
            is_admin = self.has_admin_permission(self.request.user)
            context['headers'] = self.admin_table_header if is_admin else self.user_table_header
            data = self.table_model

            # 検索処理
            search_query = self.request.GET.get('search', '')
            if search_query:
                data = data.filter(self.get_search_query(search_query)).distinct()

            paginator = Paginator(data, 10)
            page_number = self.request.GET.get('page', 1)
            # 1ページに表示するデータ
            page_obj = paginator.get_page(page_number)
            # データが10件以上ならページネーションを表示
            display_pagination = True if data.count() > 10 else False

            formatted_data = self.format_data(page_obj, is_admin)

            excel_export_url = reverse(self.excel_export_url) if self.excel_export_url else None
            excel_import_url = reverse(self.excel_import_url) if self.excel_import_url else None
            pdf_export_url = reverse(self.pdf_export_url) if self.pdf_export_url else None
            pdf_import_url = reverse(self.pdf_import_url) if self.pdf_import_url else None

            context.update({
                'title': self.title,
                'page_title': self.page_title,
                'form_dir': self.form_dir,
                'add_button_text': self.add_button_text,
                'data': formatted_data,
                'page_obj': page_obj,
                'search_query': search_query,
                'form_action_url': reverse(self.form_action_url),
                'excel_export_url': excel_export_url,
                'excel_import_url': excel_import_url,
                'pdf_export_url': pdf_export_url,
                'pdf_import_url': pdf_import_url,
                'display_pagination': display_pagination,
                'is_admin': is_admin
            })

            return context
        except Exception as e:
            except_output('Get context data error', e)
            raise Exception(e)

    # 登録、編集、削除などの時に、現在のページと検索条件、データを保持するのに使用
    def get_preserved_context(self, request):
        if request.method == 'DELETE':
            json_data = json.loads(request.body)
            current_page = json_data.get('current_page') or request.GET.get('page', '1')
            search_query = json_data.get('search_query') or request.GET.get('search', '')
        else:
            current_page = request.POST.get('current_page') or request.GET.get('page', '1')
            search_query = request.POST.get('search_query') or request.GET.get('search', '')

        data = self.table_model
        display_pagination = True if data.count() > 10 else False

        # 検索処理
        if search_query:
            data = data.filter(self.get_search_query(search_query)).distinct()

        paginator = Paginator(data, 10)

        # ページ番号を整数に変換し、範囲をチェック
        try:
            page_number = int(current_page)

            if page_number > paginator.num_pages:
                page_number = paginator.num_pages
            elif page_number < 1:
                page_number = 1
        except (ValueError, TypeError):
            page_number = 1

        page_obj = paginator.get_page(page_number)

        # データの整形
        is_admin = self.has_admin_permission(self.request.user)
        formatted_data = self.format_data(page_obj, is_admin)

        return {
            'data': formatted_data,
            'page_obj': page_obj,
            'search_query': search_query,
            'form_action_url': reverse(self.form_action_url),
            'headers': self.admin_table_header,
            'display_pagination': display_pagination,
            'is_admin': is_admin
        }

    def extra_registar(self, request, model=None, action='create'):
        pass

    def post(self, request, *args, **kwargs):
        from daihatsu.log import input_error_logger

        if 'pk' in kwargs:
            # 編集処理
            try:
                model = get_object_or_404(self.crud_model, pk=kwargs['pk'])
                data = request.POST.dict()

                # バリデーション
                errors = self.validate_data(data, pk=kwargs['pk'])
                if errors:
                    try:
                        input_error_logger.info(errors)
                    except Exception as e:
                        print(e)
                    return JsonResponse({
                        'status': 'error',
                        'message': '入力内容に誤りがあります。',
                        'errors': errors
                    }, status=400)

                # モデルの更新
                self.update_model(model, data, request.user, request.FILES)
                self.extra_registar(request, model, 'update')

                # 現在のページ情報を保持してコンテキストを生成
                context = self.get_preserved_context(request)
                html = render_to_string(self.template_dir + '/table.html', context, request=request)

                return JsonResponse({
                    'status': 'success',
                    'message': f'{self.noti_text}が正常に更新されました。',
                    'html': html
                })
            except Exception as e:
                except_output('Update error', e)
                return JsonResponse({
                    'status': 'error',
                    'message': 'データの更新中にエラーが発生しました。'
                }, status=400)
        else:
            # 新規登録処理
            try:
                data = request.POST.dict()

                # バリデーション
                errors = self.validate_data(data)
                if errors:
                    input_error_logger.info(errors)
                    return JsonResponse({
                        'status': 'error',
                        'message': '入力内容に誤りがあります。',
                        'errors': errors
                    }, status=400)

                # モデルの作成
                create_model = self.create_model(data, request.user, request.FILES)
                self.extra_registar(request, create_model, 'create')
                # 現在のページ情報を保持してコンテキストを生成
                context = self.get_preserved_context(request)
                html = render_to_string(self.template_dir + '/table.html', context, request=request)

                return JsonResponse({
                    'status': 'success',
                    'message': f'{self.noti_text}が正常に登録されました。',
                    'html': html
                })
            except Exception as e:
                except_output('Create error', e)
                return JsonResponse({
                    'status': 'error',
                    'message': 'データの登録中にエラーが発生しました。'
                }, status=400)

    def extra_delete(self, request):
        pass

    def delete(self, request, *args, **kwargs):
        try:
            model = get_object_or_404(self.crud_model, pk=kwargs['pk'])
            model.delete()

            # 現在のページ情報を保持してコンテキストを生成
            context = self.get_preserved_context(request)
            html = render_to_string(self.template_dir + '/table.html', context, request=request)

            return JsonResponse({
                'status': 'success',
                'message': f'{self.noti_text}が正常に削除されました。',
                'html': html
            })
        except Exception as e:
            except_output('Delete error', e)
            return JsonResponse({
                'status': 'error',
                'message': 'データの削除中にエラーが発生しました。'
            }, status=400)
