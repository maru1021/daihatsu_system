import re
import html
import urllib.parse
import secrets
import os
from django.utils.deprecation import MiddlewareMixin
from django.http import HttpResponseForbidden
from daihatsu.except_output import except_output
from daihatsu.middleware import get_client_ip, get_current_user
from django.utils import timezone
from django.shortcuts import render


class LoginRequiredMiddleware:
    """
    全ページでログインを必須にするミドルウェア
    """

    def __init__(self, get_response):
        self.get_response = get_response

        # ログイン不要なURLパス（前方一致）
        self.exempt_paths = [
            '/auth/login',     # ログインページ
            '/admin/login/',   # Django admin ログイン
            '/admin/logout/',  # Django admin ログアウト
            '/in_room/',       # 入退室管理
            '/actual_production/attendance-input/submit/',  # 勤怠入力送信
            '/schedule_import', # Outlookからの予定取得
            '/local_error', # localで行うバッチ処理時のエラーの取得
            '/tools/graph-maker/', # グラフ作成ツール
            '/static/', # 静的ファイル
        ]

    def __call__(self, request):
        # ログイン済みの場合は処理を続行
        if request.user.is_authenticated:
            return self.get_response(request)

        # 除外URLかチェック
        if self.is_exempt(request):
            return self.get_response(request)

        # ログインページにリダイレクト
        from django.shortcuts import redirect
        from django.conf import settings

        login_url = getattr(settings, 'LOGIN_URL', '/auth/login')
        return redirect(f'{login_url}?next={request.path}')

    def is_exempt(self, request):
        """リクエストが認証不要かチェック"""
        path = request.path

        # パス前方一致チェック
        for exempt_path in self.exempt_paths:
            if path.startswith(exempt_path):
                return True

        return False


class IPSpoofingDetectionMiddleware:
    """
    IP偽装検出ミドルウェア - 偽装検出時にアクセス拒否
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        real_ip = request.META.get('REMOTE_ADDR', '未知')

        # ローカル接続での偽装ヘッダー検出
        if real_ip in ['::1', 'localhost']:
            suspicious_headers = []
            for header in ['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'HTTP_CLIENT_IP', 'HTTP_X_ORIGINATING_IP']:
                if request.META.get(header):
                    suspicious_headers.append(f"{header}: {request.META.get(header)}")

            if suspicious_headers:
                except_output("IP偽装攻撃を検出", f" 実IP: {real_ip}, 偽装ヘッダー: {suspicious_headers}", type='security')
                context = {
                    'reason': 'local_spoofing',
                    'real_ip': real_ip,
                    'suspicious_headers': suspicious_headers,
                    'timestamp': timezone.now(),
                }
                response = render(request, 'auth/ip_spoofing_blocked.html', context)
                response.status_code = 403
                return response

        # X-Forwarded-For ヘッダーでの高度な偽装検出
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()

            # 疑わしいパターンを検出
            if real_ip == '127.0.0.1' and not ip.startswith(('127.', '10.', '172.16.', '192.168.')):
                except_output("高度なIP偽装攻撃を検出", f" ローカル接続でのパブリックIP偽装: {ip} (実IP: {real_ip})", type='security')
                context = {
                    'reason': 'advanced_spoofing',
                    'real_ip': real_ip,
                    'spoofed_ip': ip,
                    'timestamp': timezone.now(),
                }
                response = render(request, 'auth/ip_spoofing_blocked.html', context)
                response.status_code = 403
                return response
            elif not real_ip.startswith(('127.', '10.', '172.16.', '192.168.')) and ip.startswith(('127.', '10.', '172.16.', '192.168.')):
                except_output("高度なIP偽装攻撃を検出", f" パブリック接続でのプライベートIP偽装: {ip} (実IP: {real_ip})", type='security')
                context = {
                    'reason': 'public_spoofing',
                    'real_ip': real_ip,
                    'spoofed_ip': ip,
                    'timestamp': timezone.now(),
                }
                response = render(request, 'auth/ip_spoofing_blocked.html', context)
                response.status_code = 403
                return response

        return self.get_response(request)


class UntrustedProxyBlockMiddleware:
    """
    信頼できないプロキシからの接続をブロックするミドルウェア
    """
    def __init__(self, get_response):
        self.get_response = get_response
        from django.conf import settings
        self.TRUSTED_PROXIES = getattr(settings, 'TRUSTED_PROXIES', ['127.0.0.1', '::1'])
        self.BLOCK_ENABLED = getattr(settings, 'BLOCK_UNTRUSTED_PROXIES', False)

    def __call__(self, request):
        # 信頼できないプロキシをチェック
        if self.BLOCK_ENABLED and self._is_untrusted_proxy(request):
            return self._block_request(request)

        response = self.get_response(request)
        return response

    def _is_untrusted_proxy(self, request):
        """信頼できないプロキシかどうかを判定"""
        real_ip = request.META.get('REMOTE_ADDR', '')
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')

        # X-Forwarded-Forがあり、かつREMOTE_ADDRが信頼できないプロキシの場合
        if x_forwarded_for and real_ip not in self.TRUSTED_PROXIES:
            return True
        return False

    def _block_request(self, request):
        """信頼できないプロキシからのリクエストをブロック"""
        from django.http import HttpResponseForbidden
        from django.shortcuts import render
        from daihatsu.except_output import except_output
        from django.utils import timezone

        real_ip = request.META.get('REMOTE_ADDR', '不明')
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')

        # セキュリティログに記録
        except_output(
            '信頼できないプロキシからのアクセスをブロック',
            f'Real IP: {real_ip}, X-Forwarded-For: {x_forwarded_for}, Path: {request.path}',
            'security'
        )

        # ブロックページを表示
        context = {
            'reason': 'untrusted_proxy',
            'real_ip': real_ip,
            'forwarded_for': x_forwarded_for,
            'timestamp': timezone.now(),
        }
        response = render(request, 'auth/untrusted_proxy_blocked.html', context)
        response.status_code = 403
        return response


class SecurityLoggingMiddleware(MiddlewareMixin):
    """
    セキュリティ攻撃検知・ログ記録ミドルウェア
    XSS、SQLインジェクション、ディレクトリトラバーサル等の攻撃を検知
    """

    def __init__(self, get_response):
        self.get_response = get_response
        # Django 5.2対応
        self.async_mode = False
        # 不審なリクエストパターン定義
        self.suspicious_patterns = [
            (r'<script.*?>.*?</script>', 'XSS Attack'),
            (r'<iframe.*?>.*?</iframe>', 'XSS iframe Attack'),
            (r'javascript:', 'JavaScript Injection'),
            (r'\bon\w+\s*=', 'XSS Event Handler'),             # onerror=, onload=等（単語境界付き）
            (r'&lt;.*?&gt;', 'HTML Entity XSS'),                # HTMLエンティティ
            (r'&#\d+;', 'Numeric Entity XSS'),                  # 数値エンティティ
            (r'%3[cC].*?%3[eE]', 'URL Encoded XSS'),            # URLエンコード
            (r'data\s*:\s*text/html', 'Data URI XSS'),          # data:text/html
            (r'data\s*:\s*[^,]*base64', 'Data URI Base64 XSS'),    # data:...;base64,
            (r'(union|select|drop|insert|delete|update)\s+', 'SQL Injection'),
            (r'(\.\./){2,}', 'Directory Traversal'),
            (r'(cmd|exec|system|eval)\s*\(', 'Code Injection'),
            (r'(passwd|shadow|hosts|config)', 'System File Access'),
            (r'<\?php', 'PHP Code Injection'),
        ]

    def __call__(self, request):
        """
        リクエストを検査して不審なパターンを検知
        リクエスト時に自動実行されるメソッド
        """
        try:
            # リクエストデータの収集
            request_data = self._get_request_data(request)

            # パターンマッチング検査
            for pattern, attack_type in self.suspicious_patterns:
                match = re.search(pattern, request_data, re.IGNORECASE)
                if match:
                    # マッチした実際の攻撃文字列を取得
                    matched_string = match.group(0)

                    # セキュリティログに記録
                    self._log_security_incident(request, attack_type, pattern, request_data, matched_string)

                    # 攻撃をブロック（専用ページに遷移）
                    from django.shortcuts import render
                    from django.utils import timezone

                    context = {
                        'attack_type': attack_type,
                        'attack_string': matched_string,
                        'client_ip': get_client_ip(request),
                        'user_info': get_current_user().username if get_current_user() and hasattr(get_current_user(), 'username') else 'Anonymous',
                        'timestamp': timezone.now(),
                    }
                    response = render(request, 'auth/security_attack_blocked.html', context)
                    response.status_code = 403
                    return response

            # 攻撃が検出されなかった場合は次のミドルウェア/ビューを実行
            response = self.get_response(request)
            return response

        except Exception as e:
            except_output('SecurityLoggingMiddleware Error', e, 'error')
            # エラーが発生した場合でも次のミドルウェア/ビューを実行
            response = self.get_response(request)
            return response

    def _get_request_data(self, request):
        """
        検査対象のリクエストデータを取得
        """
        data_parts = []

        # URLパス
        data_parts.append(request.path)

        # GETパラメータ
        for key, value in request.GET.items():
            data_parts.append(f"{key}={value}")

        # POSTパラメータ（ファイルアップロード以外、CSRFトークンは除外）
        if hasattr(request, 'POST'):
            for key, value in request.POST.items():
                if isinstance(value, str) and key not in ['csrfmiddlewaretoken']:
                    data_parts.append(f"{key}={value}")

        # User-Agent（攻撃ツール検知用）
        user_agent = request.META.get('HTTP_USER_AGENT', '')
        data_parts.append(user_agent)

        combined_data = ' '.join(data_parts)

        # エンティティ・エンコーディング正規化
        normalized_data = self._normalize_data(combined_data)

        return normalized_data

    def _normalize_data(self, data):
        """
        各種エンコーディングを正規化して隠蔽された攻撃を検出
        """
        try:
            # URLデコード
            decoded = urllib.parse.unquote(data, errors='ignore')
            # HTMLエンティティデコード
            decoded = html.unescape(decoded)
            # 追加正規化
            decoded = decoded.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
            return decoded + ' ' + data  # 元データも保持
        except:
            return data

    def _log_security_incident(self, request, attack_type, pattern, request_data, matched_string):
        """
        セキュリティインシデントをログに記録
        """
        client_ip = get_client_ip(request)
        # ThreadLocalからユーザー取得
        user = get_current_user()

        log_message = (
            f"{attack_type} | "
            f"IP: {client_ip} | User: {user} | "
            f"Path: {request.path} | Method: {request.method} | "
            f"Attack String: {matched_string}"
        )

        # セキュリティログに記録
        except_output('Security Attack Detected', log_message, 'security')
