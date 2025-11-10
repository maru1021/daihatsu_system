"""
実際の外部プロキシサーバーの動作を模擬
"""
import http.server
import socketserver
import urllib.request

class UntrustedProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        target_url = f'http://localhost:8000{self.path}'

        try:
            # 元のヘッダーをコピー
            headers = {}
            for header, value in self.headers.items():
                if header.lower() != 'host':
                    headers[header] = value

            # 外部プロキシを模擬：実際のクライアントIPを設定
            # このプロキシは信頼できないプロキシとして動作
            client_ip = self.client_address[0]
            headers['X-Forwarded-For'] = '203.0.113.50'  # 実際の外部クライアントを模擬
            headers['Host'] = 'localhost:8000'

            # 実際の外部プロキシを模擬するため、ローカルヘッダーを削除
            headers_to_remove = ['X-Real-IP', 'X-Forwarded-Proto', 'X-Forwarded-Host']
            for header in headers_to_remove:
                headers.pop(header, None)

            # POSTデータがある場合は読み取り
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else None

            # リクエストを作成
            req = urllib.request.Request(target_url, data=post_data, headers=headers, method=self.command)

            # リクエストを転送
            with urllib.request.urlopen(req, timeout=30) as response:
                # レスポンスを転送
                self.send_response(response.getcode())

                # ヘッダーを転送
                for header, value in response.headers.items():
                    if header.lower() not in ['connection', 'transfer-encoding']:
                        self.send_header(header, value)
                self.end_headers()

                # ボディを転送
                content = response.read()
                self.wfile.write(content)

        except urllib.error.HTTPError as e:
            if e.code == 403:
                # Djangoからのセキュリティブロックページを転送
                self.send_response(403)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()

                block_content = e.read().decode('utf-8')
                self.wfile.write(block_content.encode('utf-8'))
            else:
                self.send_error(502, f"Proxy Error: HTTP {e.code} {e.reason}")
        except Exception as e:
            self.send_error(502, f"Proxy Error: {e}")

if __name__ == '__main__':
    proxy_port = 9999

    print(f"=== 信頼できないプロキシサーバー動作確認用 ===")
    print(f"ポート: {proxy_port}")
    print(f"転送先: localhost:8000")
    print(f"")
    print(f"テスト方法:")
    print(f"ブラウザで http://localhost:{proxy_port}/auth/login/ にアクセス")
    print(f"セキュリティページが表示されること、log/security.logに記録されることを確認してください")

    with socketserver.TCPServer(("", proxy_port), UntrustedProxyHandler) as httpd:
        try:
            print(f"プロキシサーバーを開始しました: http://localhost:{proxy_port}")
            print(f"停止するには Ctrl+C を押してください")
            httpd.serve_forever()
        except KeyboardInterrupt:
            print(f"\n[PROXY] プロキシサーバーを停止しました")
