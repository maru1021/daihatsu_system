from django.shortcuts import render
from django.views import View


class GraphMakerView(View):
    # テンプレートマッピング
    TEMPLATE_MAP = {
        'machine': 'tools/graph_maker/machining_graph_maker.html',
        'default': 'tools/graph_maker/graph_maker.html',
    }

    def get(self, request, template_type=None, *args, **kwargs):
        # URLパラメータに応じてテンプレートを選択
        if template_type and template_type in self.TEMPLATE_MAP:
            template_name = self.TEMPLATE_MAP[template_type]
        else:
            template_name = self.TEMPLATE_MAP['default']

        return render(request, template_name)
