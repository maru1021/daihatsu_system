from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.shortcuts import render
from django.template.loader import render_to_string
from django.views.generic import TemplateView
from django.urls import reverse
from django.db.models import Q
from django.core.paginator import Paginator
from datetime import date, datetime

from daihatsu.except_output import except_output


class AggregationTableView(TemplateView):
    title = None
    page_title = None
    table_model = None
    template_dir = 'template_pages/table'
    admin_table_header = []
    user_table_header = []
    search_fields = []
    search_date_url = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def get(self, request, *args, **kwargs):
        try:
            is_htmx = request.headers.get('HX-Request')
            has_search_param = 'search' in request.GET
            has_page = request.GET.get('page') is not None

            # 検索やページネーション時
            if is_htmx and (has_search_param or has_page):
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

    def setup(self, request, *args, **kwargs):
        super().setup(request, *args, **kwargs)
        search_date = kwargs.get("search_date")
        if search_date:
            try:
                self.search_date = datetime.strptime(search_date, "%Y-%m-%d").date()
            except ValueError as e:
                except_output("Invalid date format. Use YYYY-MM-DD.", e)
        else:
            self.search_date = date.today()

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

            paginator = Paginator(data, 20)
            page_number = self.request.GET.get('page', 1)
            # 1ページに表示するデータ
            page_obj = paginator.get_page(page_number)
            # データが10件以上ならページネーションを表示
            display_pagination = True if data.count() > 20 else False

            formatted_data = self.format_data(page_obj, is_admin)

            context.update({
                'title': self.title,
                'page_title': self.page_title,
                'data': formatted_data,
                'page_obj': page_obj,
                'search_query': search_query,
                'display_pagination': display_pagination,
                'is_admin': is_admin,
                'aggrigation': True,
                'date': self.search_date.strftime('%Y-%m-%d'),
                'search_date_url': reverse(self.search_date_url),
            })

            return context
        except Exception as e:
            except_output('Get context data error', e)
            raise Exception(e)
