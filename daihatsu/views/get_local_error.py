from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.http import JsonResponse
import json
from daihatsu.except_output import except_output

@method_decorator(csrf_exempt, name='dispatch')
class GetLocalError(View):
    def post(self, request):
        try:
            # リクエストボディからデータを取得
            body = request.body.decode('utf-8')

            # JSONとして送信された場合
            if body and body.startswith('{'):
                data = json.loads(body)
            # フォームデータとして送信された場合
            elif request.POST:
                data = request.POST.dict()
            else:
                data = {}

            # エラーログに記録
            title = data.get('title', 'Unknown Error')
            message = data.get('message', '')
            name = data.get('name', '')
            message = f"{name},{message}"

            # message内のJSON文字列をデコード
            try:
                # レスポンス部分のJSON文字列を抽出してデコード
                import re
                json_match = re.search(r'\{[^}]+\}', message)
                if json_match:
                    json_str = json_match.group(0)
                    decoded_json = json.loads(json_str)
                    # デコードしたJSONを文字列に戻す
                    message = message.replace(json_str, str(decoded_json))
            except:
                pass  # デコードできない場合はそのまま

            except_output(title, message, type='local_error')

            return JsonResponse({'status': 'success', 'message': 'Error logged'}, status=200)

        except Exception as e:
            except_output('GetLocalError error', e)
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)
