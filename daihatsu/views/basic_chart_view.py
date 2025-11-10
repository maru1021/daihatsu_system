from django.views.generic import TemplateView
from django.http import JsonResponse


class BasicChartView(TemplateView):
    timestamp_format = '%H:%M'

    border_colors = [
        'rgb(75, 192, 192)',
        'rgb(255, 205, 86)',
        'rgb(54, 162, 235)',
        'rgb(255, 99, 132)',
        'rgb(153, 102, 255)',
        'rgb(255, 159, 64)',
        'rgb(201, 203, 207)',
        'rgb(102, 187, 106)',
        'rgb(255, 193, 7)',
        'rgb(233, 30, 99)'
      ]

    background_colors = [
        'rgba(75, 192, 192, 0.2)',
        'rgba(255, 205, 86, 0.2)',
        'rgba(54, 162, 235, 0.2)',
        'rgba(255, 99, 132, 0.2)',
        'rgba(153, 102, 255, 0.2)',
        'rgba(255, 159, 64, 0.2)',
        'rgba(201, 203, 207, 0.2)',
        'rgba(102, 187, 106, 0.2)',
        'rgba(255, 193, 7, 0.2)',
        'rgba(233, 30, 99, 0.2)'
    ]

    tension = 0.1
    point_radius = 2

    def __init__(self, *args, **kwargs):
        pass

    def get(self, request, *args, **kwargs):
        # リクエストパラメータで初期化か更新かを判定
        is_update = request.GET.get('update', 'false').lower() == 'true'

        if is_update:
            # 更新時は最新の1件のみを返す
            latest_resource = self.model[-1] if self.model else None
            if latest_resource:
                return JsonResponse({
                    'timestamp': latest_resource.created_at.strftime(self.timestamp_format),
                    'data': [
                        latest_resource.cpu,
                        latest_resource.memory,
                        latest_resource.disk
                    ]
                })
            else:
                return JsonResponse({'error': 'データが見つかりません'})
        else:
            # 初期化時は完全なデータセットを返す
            datasets = []

            for i, (label, data) in enumerate(zip(self.vertical_labels, self.data_list)):
                datasets.append({
                    'label': label,
                    'data': data,
                    'borderColor': self.border_colors[i],
                    'backgroundColor': self.background_colors[i],
                    'tension': self.tension,
                    'pointRadius': self.point_radius
                })

            return JsonResponse({
                'labels': self.horizontal_labels,
                'datasets': datasets,
            })
