from management_room.models import AkashiOrderList
from management_room.auth_mixin import ManagementRoomPermissionMixin
from daihatsu.views.aggregation_table_view import AggregationTableView
from daihatsu.except_output import except_output
from django.utils.safestring import mark_safe
from datetime import date, timedelta

import calendar

from django.db.models import Sum, Q, Value, IntegerField
from django.db.models.functions import Coalesce


from django.db.models import Sum
from daihatsu.except_output import except_output

class AkashiOderAggregationView(ManagementRoomPermissionMixin, AggregationTableView):
    title = '明石発注データ集計'
    page_title = '明石発注データ集計'
    admin_table_header = ['品番', '日数量', '週数量', '月数量']
    user_table_header = ['品番', '日数量', '週数量', '月数量']
    search_fields = ['product_number']
    search_date_url = 'management_room:akashi_order_aggregation'

    def get_context_data(self, **kwargs):
        search_date = self.search_date
        month_start = search_date.replace(day=1)

        last_day = calendar.monthrange(search_date.year, search_date.month)[1]
        month_end = search_date.replace(day=last_day)

        week_start = search_date - timedelta(days=search_date.weekday())  # 月曜始まり
        week_end = week_start + timedelta(days=6)

        self.table_model = AkashiOrderList.objects.values('product_number').annotate(
            day_quantity=Coalesce(
                Sum('quantity', filter=Q(delivery_date=search_date)),
                Value(0),
                output_field=IntegerField(),
            ),
            week_quantity=Coalesce(
                Sum('quantity', filter=Q(delivery_date__range=(week_start, week_end))),
                Value(0),
                output_field=IntegerField(),
            ),
            month_quantity=Coalesce(
                Sum('quantity', filter=Q(delivery_date__range=(month_start, month_end))),
                Value(0),
                output_field=IntegerField(),
            ),
        ).order_by('product_number')

        return super().get_context_data(**kwargs)

    # テーブルに返すデータの整形
    def format_data(self, page_obj, is_admin=True):
        try:
            formatted_data = []
            if is_admin:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row['product_number'] if row['product_number'] else '',
                            row['day_quantity'] if row['day_quantity'] else 0,
                            row['week_quantity'] if row['week_quantity'] else 0,
                            row['month_quantity'] if row['month_quantity'] else 0,
                        ],
                    })
            else:
                for row in page_obj:
                    formatted_data.append({
                        'fields': [
                            row['product_number'] if row['product_number'] else '',
                            row['day_quantity'] if row['day_quantity'] else 0,
                            row['week_quantity'] if row['week_quantity'] else 0,
                            row['month_quantity'] if row['month_quantity'] else 0,
                        ],
                    })
            return formatted_data
        except Exception as e:
            except_output('Format data error', e)
            raise Exception(e)
