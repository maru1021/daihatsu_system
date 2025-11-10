from django.views.generic import TemplateView
from daihatsu.models import Resource
from django.shortcuts import render
from daihatsu.views.basic_chart_view import BasicChartView
from daihatsu.log import error_logger
from django.http import JsonResponse
from datetime import timedelta
from django.utils import timezone
from django.db.models import Avg
from django.db.models.functions import TruncHour

class ResourceView(TemplateView):
    template_name = 'resource/resource.html'
    content_template = 'resource/resource_content.html'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        resources = Resource.objects.filter(created_at__gte=timezone.now() - timedelta(days=1)).order_by('-created_at')
        if resources:
            # 平均値を計算
            avg_cpu = sum(r.cpu for r in resources) / len(resources)
            avg_memory = sum(r.memory for r in resources) / len(resources)
            avg_disk = sum(r.disk for r in resources) / len(resources)
            self.average_resource = {
                'cpu': round(avg_cpu, 1),
                'memory': round(avg_memory, 1),
                'disk': round(avg_disk, 1)
            }
        else:
            self.average_resource = None

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        # グラフ設定のみをcontextに渡す（データはAjaxで取得）
        context.update({
            'latest_resource': self.average_resource,
            'chart_id': 'resourceChart',
        })
        return context

    def get(self, request, *args, **kwargs):
        try:
            is_htmx = request.headers.get('HX-Request')
            is_update = request.GET.get('update', 'false').lower() == 'true'

            if is_update:
                return JsonResponse(self.average_resource)

            if is_htmx:
                return render(request, self.content_template, self.get_context_data())
            return super().get(request, *args, **kwargs)
        except Exception as e:
            error_logger.error(f'Get error: {str(e)}', exc_info=True)


class ResourceDataView(BasicChartView):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        resources = Resource.objects.order_by('-created_at')[:60]
        self.model = list(reversed(resources))

        self.horizontal_labels = [r.created_at.strftime('%H:%M') for r in self.model]
        self.vertical_labels = ["CPU使用率(%)", "メモリ使用率(%)", "ディスク使用率(%)"]

        self.cpu_data = [r.cpu for r in self.model]
        self.memory_data = [r.memory for r in self.model]
        self.disk_data = [r.disk for r in self.model]
        self.data_list = [self.cpu_data, self.memory_data, self.disk_data]


class ResourceHourlyDataView(BasicChartView):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 過去24時間のデータを1時間ごとにグループ化して平均値を計算
        # 過去24時間のデータを取得
        end_time = timezone.now()
        start_time = end_time - timedelta(hours=24)

        # 1時間ごとにグループ化して平均値を計算
        hourly_averages = Resource.objects.filter(
            created_at__gte=start_time,
            created_at__lte=end_time
        ).annotate(
            hour=TruncHour('created_at')
        ).values('hour').annotate(
            avg_cpu=Avg('cpu'),
            avg_memory=Avg('memory'),
            avg_disk=Avg('disk')
        ).order_by('hour')

        # グラフ用データを準備
        self.horizontal_labels = [item['hour'].strftime('%H:%M') for item in hourly_averages]
        self.vertical_labels = ["CPU使用率(%)", "メモリ使用率(%)", "ディスク使用率(%)"]

        self.cpu_data = [item['avg_cpu'] for item in hourly_averages]
        self.memory_data = [item['avg_memory'] for item in hourly_averages]
        self.disk_data = [item['avg_disk'] for item in hourly_averages]
        self.data_list = [self.cpu_data, self.memory_data, self.disk_data]
