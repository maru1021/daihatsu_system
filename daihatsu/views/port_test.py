from django.shortcuts import render
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import JsonResponse
from django.views import View
from django import forms
from django.core.exceptions import ValidationError
import socket
import time


class PortTestView(LoginRequiredMixin, View):
    """ポートテスト機能"""

    def get(self, request, *args, **kwargs):
        """GET リクエスト処理"""
        context = {'page_title': 'ポートテスト'}

        # HTMX リクエストの場合はコンテンツ部分のみ返す
        if request.headers.get('HX-Request'):
            return render(request, 'tools/port_test/content.html', context)

        # 通常リクエストはフルページを返す
        return render(request, 'tools/port_test/full_page.html', context)

    def post(self, request, *args, **kwargs):
        """POST リクエスト処理 - ポートテスト実行"""

        result = self._execute_port_test(request.POST)

        return JsonResponse({
            'status': 'success',
            'result': result
        })

    def _execute_port_test(self, data):
        """ポートテスト実行処理"""
        ip_address = data['ip_address']
        port = int(data['port'])
        timeout = int(data['timeout'])

        result = {
            'ip_address': ip_address,
            'port': port,
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        }

        start_time = time.time()

        try:
            # ソケット作成
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)

                # 接続テスト
                sock.connect((ip_address, port))
                connection_time = time.time() - start_time
                result['connection_time'] = round(connection_time * 1000, 2)  # ミリ秒
                result['success'] = True

        except socket.timeout:
            result['error'] = f'タイムアウトしました（{timeout}秒）'
        except ConnectionRefusedError:
            result['error'] = '接続が拒否されました'
        except Exception as e:
            result['error'] = f'エラー: {str(e)}'

        return result
