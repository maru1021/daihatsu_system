from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from django.views import View
from django.shortcuts import render
import json
from pathlib import Path

from daihatsu.AI.claude_service import ClaudeService
from daihatsu.except_output import except_output


@method_decorator(ensure_csrf_cookie, name='dispatch')
class AIQueryView(View):
    """AIクエリ処理ビュー（MCP対応）"""

    def get(self, request):
        """GETリクエストの処理（テンプレート表示）"""
        is_htmx = request.headers.get('HX-Request')
        if is_htmx:
            return render(request, 'ai_query/content.html')
        else:
            return render(request, 'ai_query/full_page.html')

    def post(self, request):
        """POSTリクエストの処理（AIクエリ実行）"""
        try:
            # JSONデータを解析
            data = json.loads(request.body)
            query = data.get('query', '').strip()

            if not query:
                return JsonResponse({
                    'success': False,
                    'error': 'クエリが空です'
                })

            return self._handle_claude_code_query(query)
        except Exception as e:
            except_output("Unexpected error", e)
            return JsonResponse({
                'success': False,
                'error': 'クエリの処理中にエラーが発生しました。'
            })

    def _load_claude_md_content(self):
        """CLAUDE.mdファイルの内容を読み込む"""
        try:
            # プロジェクトルートの.claude/CLAUDE.mdファイルを読み込み
            claude_md_path = Path(__file__).parent.parent.parent / '.claude' / 'CLAUDE.md'

            if claude_md_path.exists():
                with open(claude_md_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                return content
            else:
                except_output("CLAUDE.md file not found", claude_md_path)
                return None
        except Exception as e:
            except_output("Error loading CLAUDE.md", e)
            return None

    def _handle_claude_code_query(self, query: str) -> JsonResponse:
        """Claude Code との通信"""
        try:
            message = query.strip()

            if not message:
                return JsonResponse({
                    'success': False,
                    'error': 'メッセージが空です'
                })

            # Claude Code サービスを初期化
            claude_service = ClaudeService()

            # CLAUDE.mdファイルの内容を読み込み
            system_prompt = self._load_claude_md_content()

            # Claude Code にメッセージを送信
            result = claude_service.send_message(message, system_prompt)

            if result['success']:
                return JsonResponse({
                    'success': True,
                    'response': result['response'],
                    'model': result.get('model', 'claude-code'),
                    'execution_time': result.get('execution_time', 0),
                    'query_type': 'claude_code'
                })
            else:
                return JsonResponse({
                    'success': False,
                    'error': result['error']
                })

        except Exception as e:
            except_output("Claude Code error", e)
            return JsonResponse({
                'success': False,
                'error': 'Claude Code との通信でエラーが発生しました。'
            })
