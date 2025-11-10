import time
import psutil
from .log import performance_logger
import threading
from functools import wraps
from .except_output import except_output
from django.shortcuts import render
from django.utils import timezone

# スレッドローカルストレージ
_thread_locals = threading.local()


# 現在のユーザーを取得
def get_current_user():
    return getattr(_thread_locals, 'current_user', None)

# 現在のリクエストを取得
def get_current_request():
    return getattr(_thread_locals, 'current_request', None)

def get_client_ip(request):
    """クライアントIPアドレスを取得（偽装対策付き）"""
    from django.conf import settings

    # settings.pyから信頼できるプロキシのリストを取得
    TRUSTED_PROXIES = getattr(settings, 'TRUSTED_PROXIES', ['127.0.0.1', '::1'])

    real_ip = request.META.get('REMOTE_ADDR', '不明')

    # 複数のプロキシヘッダーをチェック（優先順位順）
    forwarded_for = (
        request.META.get('HTTP_X_FORWARDED_FOR') or
        request.META.get('HTTP_X_REAL_IP') or
        request.META.get('HTTP_CLIENT_IP')
    )

    # プロキシヘッダーがない場合は、REMOTE_ADDRを返す
    if not forwarded_for:
        return real_ip

    # X-Forwarded-Forは複数のIPを含む可能性があるため、最初のIPを取得
    if ',' in forwarded_for:
        forwarded_ip = forwarded_for.split(',')[0].strip()
    else:
        forwarded_ip = forwarded_for.strip()

    # プロキシ経由の場合：信頼できるプロキシからの接続のみForwarded IPを使用
    if real_ip in TRUSTED_PROXIES:
        return forwarded_ip
    else:
        # 信頼できないプロキシの場合：REMOTE_ADDRを優先（Forwarded IPを無視）
        return real_ip


# ユーザー情報をスレッドローカルに保存するミドルウェア
class UserMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # リクエストの開始時にユーザー情報を保存
        _thread_locals.current_user = request.user
        _thread_locals.current_request = request

        response = self.get_response(request)

        # リクエスト終了時にクリーンアップ
        if hasattr(_thread_locals, 'current_user'):
            delattr(_thread_locals, 'current_user')
        if hasattr(_thread_locals, 'current_request'):
            delattr(_thread_locals, 'current_request')

        return response

# リクエストローカルキャッシュクラス
class RequestLocalCache:
    """リクエスト内でのキャッシュ管理"""
    _local = threading.local()

    @classmethod
    def get_cache(cls):
        if not hasattr(cls._local, 'cache'):
            cls._local.cache = {}
        return cls._local.cache

    @classmethod
    def get(cls, key, default=None):
        return cls.get_cache().get(key, default)

    @classmethod
    def set(cls, key, value):
        cls.get_cache()[key] = value

    @classmethod
    def clear(cls):
        if hasattr(cls._local, 'cache'):
            cls._local.cache.clear()

# リクエスト内でメソッドの結果をキャッシュ
def request_cache(func):
    @wraps(func)
    def wrapper(cls, *args, **kwargs):
        cache_key = f"{cls.__name__}.{func.__name__}:{':'.join(map(str, args))}"

        cached_result = RequestLocalCache.get(cache_key)
        if cached_result is not None:
            return cached_result

        result = func(cls, *args, **kwargs)
        RequestLocalCache.set(cache_key, result)
        return result

    return wrapper

class RequestCacheMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        RequestLocalCache.clear()
        response = self.get_response(request)
        RequestLocalCache.clear()
        return response


class PerformanceMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Chrome DevToolsリクエストを除外
        if '/.well-known/' in request.path:
            response = self.get_response(request)
            return response

        # リクエスト開始時の時間とメモリ使用量を記録
        start_time = time.time()
        start_memory = psutil.Process().memory_info().rss / 1024 / 1024  # MB

        # レスポンスを取得
        response = self.get_response(request)

        # 処理時間とメモリ使用量を計算
        process_time = time.time() - start_time
        end_memory = psutil.Process().memory_info().rss / 1024 / 1024  # MB
        memory_used = end_memory - start_memory

        performance_logger.info(
            f"{process_time:.3f}秒, {memory_used:.2f}MB, {request.path}"
        )

        return response
