from django.shortcuts import render
from django.views import View


class AudioAnomalyDetectionView(View):
    def get(self, request, *args, **kwargs):
        return render(request, 'tools/graph_maker/audio_anomaly_detection.html')
