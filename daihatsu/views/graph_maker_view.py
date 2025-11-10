from django.shortcuts import render
from django.views import View


class GraphMakerView(View):
    def get(self, request, *args, **kwargs):
        return render(request, 'tools/graph_maker/graph_maker.html')
