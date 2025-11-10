from django.http import JsonResponse
from django.views import View
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator


@method_decorator(ensure_csrf_cookie, name='dispatch')
class KeepSessionAliveView(LoginRequiredMixin, View):
    """
    セッション維持用エンドポイント
    1週間に1回のKeep-Alive通信でセッションを更新
    """

    def post(self, request):
        # セッションの最終アクセス時間を更新
        request.session.modified = True

        return JsonResponse({
            'status': 'success',
            'message': 'セッション更新完了',
            'user': request.user.username if request.user.is_authenticated else None
        })
