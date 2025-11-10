from django.contrib.auth.views import LoginView, LogoutView
from django.urls import reverse_lazy
from django.shortcuts import render
from django.contrib.auth import get_user_model
from daihatsu.log import access_logger
from daihatsu.models import IPBlock
from daihatsu.middleware import get_client_ip
from daihatsu.except_output import except_output
User = get_user_model()

class CustomLoginView(LoginView):
    template_name = 'auth/login.html'

    def post(self, request, *args, **kwargs):
        username = request.POST.get('username', '')
        ip_address = get_client_ip(request)

        # IPアクセスチェック（0.1秒以内に3回で10分ブロック）
        is_blocked = IPBlock.check_and_update_access(ip_address)

        if is_blocked:
            access_logger.warning(f'同一IPからの高速アクセス検出によりブロック, ユーザー: {username}')
            except_output('同一IPからの高速アクセス検出によりブロック', f'IP: ユーザー: {username}', type='security')
            return render(request, 'auth/user_locked.html', status=403)

        # ユーザーロック状態をチェック
        try:
            user = User.objects.get(username=username)
            is_locked = user.is_locked()
            if is_locked:
                access_logger.warning(f'ロックされたユーザーのログイン試行, {username}, {ip_address}')
                except_output('ロックされたユーザーのログイン試行', f'{username}', type='security')
                return render(request, 'auth/user_locked.html', status=423)
        except User.DoesNotExist:
            pass  # 存在しないユーザーの場合は通常処理へ

        # 通常のログイン処理を継続
        return super().post(request, *args, **kwargs)

    def form_valid(self, form):
        response = super().form_valid(form)
        user = form.get_user()
        ip_address = get_client_ip(self.request)

        # ログイン成功時に失敗カウンターをリセット
        user.reset_miss_count()

        access_logger.info(f'ログイン成功, {user.username}')
        return response

    def form_invalid(self, form):
        username = form.data.get('username', '')
        ip_address = get_client_ip(self.request)

        # ユーザーが存在する場合のみ失敗カウンターを増加
        try:
            user = User.objects.get(username=username)
            is_locked = user.increment_miss_count()

            if is_locked:
                access_logger.critical(f'ユーザーロック実行, {username}, 失敗回数: {user.miss_count}')
                except_output('ユーザーロック実行', f'{username}, 失敗回数: {user.miss_count}', type='security')
            else:
                access_logger.warning(f'ログイン失敗, {username}, 失敗回数: {user.miss_count}')
                except_output('ログイン失敗', f'{username}, 失敗回数: {user.miss_count}', type='security')

        except User.DoesNotExist:
            access_logger.warning(f'存在しないユーザーでのログイン試行, {username}')

        return super().form_invalid(form)


class CustomLogoutView(LogoutView):
    next_page = reverse_lazy('login')

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            access_logger.info(f'ログアウト, {request.user.username}')
        return super().dispatch(request, *args, **kwargs)
