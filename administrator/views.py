from django.shortcuts import render
from django.views.generic import TemplateView

class AdminRuleView(TemplateView):
  def get(self, request, *args, **kwargs):
    is_htmx = 'HX-Request' in request.headers
    if is_htmx:
        context = self.get_context_data(**kwargs)
        content_template = 'rule/content.html'
        return render(request, content_template, context)

    # リロード時など
    return render(request, 'rule/full_page.html')
