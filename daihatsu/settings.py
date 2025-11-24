# -*- coding: utf-8 -*-
from pathlib import Path
import ipaddress
import time
import os


# .envファイルの読み込み（UTF-8エンコーディングを明示）
try:
    from dotenv import load_dotenv
    load_dotenv(encoding='utf-8')
except ImportError:
    pass  # python-dotenvがインストールされていない場合はスキップ

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'

SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = 'django-insecure-4qw4=0)pmkh28=+9qy!p1d#bzp@tizj&a^8$vl)gmyz9b^6nih'  # 開発環境のみ
    else:
        raise ValueError('本番環境ではSECRET_KEYの環境変数設定が必須です')

if DEBUG:
    URL_BASE = 'http://127.0.0.1:8000'
else:
    URL_BASE = 'http://127.0.0.1:8000'

# キャッシュバスター関数
def get_cache_buster():
    if DEBUG:
        return int(time.time())
    else:
        return '1.0.0'

# キャッシュバスター用のコンテキストプロセッサ
def cache_buster_context_processor(request):
    return {'CACHE_BUSTER': get_cache_buster()}

# 403エラーの対策
def generate_trusted_origins(prefix=''):
    origins = []

    # フォーム入力を行うIPのサブネットを指定
    network_ranges = [
        '127.0.0.1/32',
        '10.69.0.0/16',
        '192.168.0.0/16',
    ]

    for network_str in network_ranges:
        network = ipaddress.IPv4Network(network_str, strict=False)
        for i, ip in enumerate(network.hosts()):
            if prefix:
                origins.append(f'{prefix}{ip}')
            else:
                origins.append(str(ip))
    return origins

CSRF_TRUSTED_ORIGINS = generate_trusted_origins('http://') + generate_trusted_origins('https://')
ALLOWED_HOSTS = generate_trusted_origins() + ['localhost', '127.0.0.1', '0.0.0.0']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'compressor',
    'cachalot',
    'daihatsu',
    'administrator',
    'attendance',
    'management_room',
    'manufacturing',
    'in_room',
    'actual_production',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'daihatsu.security_middleware.IPSpoofingDetectionMiddleware',  # IP偽装検出・拒否
    'daihatsu.security_middleware.UntrustedProxyBlockMiddleware',  # 信頼できないプロキシブロック
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'daihatsu.security_middleware.LoginRequiredMiddleware',  # ログイン強制ミドルウェア
    'daihatsu.middleware.UserMiddleware',  # ユーザー情報保存用
    'daihatsu.security_middleware.SecurityLoggingMiddleware',  # セキュリティ攻撃検知・ログ記録
    'daihatsu.middleware.RequestCacheMiddleware',  # リクエストローカルキャッシュ用
    'daihatsu.middleware.PerformanceMiddleware',  # パフォーマンス監視用
]

# セキュリティ設定：信頼できるプロキシ
TRUSTED_PROXIES = [
    '127.0.0.1',    # ローカルホスト（IPv4）
    '::1',          # ローカルホスト（IPv6）
    '10.69.179.254',
    '10.69.176.176',
]
BLOCK_UNTRUSTED_PROXIES = True  # TRUEにすると信頼できるプロキシ以外からのアクセスをブロック

# プロキシを使用する場合のヘッダー設定
USE_X_FORWARDED_HOST = True
USE_X_FORWARDED_PORT = True

ROOT_URLCONF = 'daihatsu.urls'

# テンプレート設定
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [
            BASE_DIR / 'daihatsu' / 'templates',
        ],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'daihatsu.settings.cache_buster_context_processor',
            ],
        },
    },
]

# 本番環境用のテンプレートキャッシュ設定
if not DEBUG:
    # 本番環境ではキャッシュローダーを使用
    TEMPLATES[0]['APP_DIRS'] = False
    TEMPLATES[0]['OPTIONS']['loaders'] = [
        ('django.template.loaders.cached.Loader', [
            'django.template.loaders.filesystem.Loader',
            'django.template.loaders.app_directories.Loader',
        ]),
    ]

WSGI_APPLICATION = 'daihatsu.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DB_NAME', 'dkc'),
        'USER': os.environ.get('DB_USER', 'dkc'),
        'PASSWORD': os.environ.get('DB_PASSWORD', 'dkc'),
        'HOST': 'localhost',
        'PORT': '5432',
        'OPTIONS': {
            'client_encoding': 'UTF8',
            'options': '-c client_encoding=UTF8',
        },
        'CONN_MAX_AGE': 0,  # 接続プールを無効化してエンコーディング問題を回避
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

LANGUAGE_CODE = 'ja'
TIME_ZONE = 'Asia/Tokyo'
USE_I18N = True
USE_TZ = False

STATIC_URL = '/static/'
STATICFILES_DIRS = [
    BASE_DIR / 'static',
]

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# 静的ファイルファインダーを明示的に設定
STATICFILES_FINDERS = [
    'django.contrib.staticfiles.finders.FileSystemFinder',
    'django.contrib.staticfiles.finders.AppDirectoriesFinder',
    'compressor.finders.CompressorFinder',  # Django Compressor用
]

if not DEBUG:
    # 本番環境：オフライン圧縮を強制
    COMPRESS_OFFLINE = True

# 圧縮設定
COMPRESS_ENABLED = True
COMPRESS_ROOT = BASE_DIR / 'static'  # 圧縮ファイルの出力先
COMPRESS_URL = STATIC_URL  # 圧縮ファイルのURL
COMPRESS_OFFLINE = True  # オフライン圧縮を有効化
COMPRESS_OFFLINE_CONTEXT = {
    'STATIC_URL': STATIC_URL,
}
# 圧縮ファイルのURLプレースホルダーを設定
COMPRESS_URL_PLACEHOLDER = STATIC_URL
COMPRESS_CSS_FILTERS = [
    'compressor.filters.css_default.CssAbsoluteFilter',
    'compressor.filters.cssmin.rCSSMinFilter',
]
COMPRESS_JS_FILTERS = [
    'compressor.filters.js_default.JSDefaultFilter',
]

# 開発環境用の設定（テンプレートキャッシュ無効化）
if DEBUG:
    # 開発環境：圧縮を無効化して開発を高速化
    COMPRESS_ENABLED = False
    # 静的ファイルのキャッシュも無効化
    STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.StaticFilesStorage'
else:
    # 本番環境：圧縮を無効化（runserver使用時）
    COMPRESS_ENABLED = True
    COMPRESS_OFFLINE = True
    # 本番環境でも静的ファイルを提供するための設定
    STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.StaticFilesStorage'
    # 本番環境用のJavaScript圧縮設定
    COMPRESS_JS_FILTERS = [
        'compressor.filters.js_default.JSDefaultFilter',
    ]


# カスタムユーザーモデル
AUTH_USER_MODEL = 'daihatsu.CustomUser'

# ログイン関連の設定
LOGIN_URL = '/auth/login'
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/auth/login'

# セッション設定（全環境共通）
SESSION_ENGINE = 'django.contrib.sessions.backends.db'  # データベースベースのセッション
SESSION_COOKIE_AGE = 86400 * 30  # 1ヶ月
SESSION_EXPIRE_AT_BROWSER_CLOSE = True  # ブラウザ閉じるとセッション削除
SESSION_SAVE_EVERY_REQUEST = True  # リクエスト毎に更新（本番環境でのセッション問題を回避）
SESSION_COOKIE_HTTPONLY = True  # JavaScript攻撃防止
SESSION_COOKIE_SAMESITE = 'Lax'  # CSRF保護と互換性を保つ

# CSRF保護設定（HTTP環境・hiddenfield対応）
CSRF_COOKIE_SECURE = False  # TrueにするとHTTPS環境でのみ有効
CSRF_COOKIE_HTTPONLY = False  # JavaScript攻撃防止（FalseにしないとCSRFトークンの取得ができない）
CSRF_COOKIE_SAMESITE = 'Strict'
CSRF_USE_SESSIONS = False  # クッキーベースに変更（セッションバックエンドの問題を回避）

# ログ設定
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '[%(asctime)s] %(levelname)s "%(message)s"',
            'datefmt': '%d/%b/%Y %H:%M:%S',
        },
        'sql_only': {
            'format': '%(message)s',
        },
    },
    'handlers': {
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        'sql_restore_file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': 'log/sql_restore.log',
            'formatter': 'sql_only',
            'encoding': 'utf-8',
        },
    },
    'loggers': {
        'django.server': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
        'sql_restore': {
            'handlers': ['sql_restore_file'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}


# 本番環境用のパフォーマンス最適化
if not DEBUG:
    # データベース接続プール設定
    DATABASES['default']['CONN_MAX_AGE'] = 600  # 10分間接続を保持

    # 静的ファイル設定の最適化
    STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.ManifestStaticFilesStorage'

    # セキュリティ設定（CSPミドルウェアで統一管理）
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = 'DENY'


    # ログ設定の最適化
    LOGGING = {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'verbose': {
                'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
                'style': '{',
            },
            'sql_only': {
                'format': '%(message)s',
            },
        },
        'handlers': {
            'console': {
                'level': 'ERROR',
                'class': 'logging.StreamHandler',
                'formatter': 'verbose',
            },
            'file': {
                'level': 'INFO',
                'class': 'logging.FileHandler',
                'filename': BASE_DIR / 'log' / 'django.log',
                'formatter': 'verbose',
            },
            'sql_restore_file': {
                'level': 'INFO',
                'class': 'logging.FileHandler',
                'filename': 'log/sql_restore.log',
                'formatter': 'sql_only',
                'encoding': 'utf-8',
            },
        },
        'loggers': {
            'django': {
                'handlers': ['console', 'file'],
                'level': 'INFO',
                'propagate': True,
            },
            'sql_restore': {
                'handlers': ['sql_restore_file'],
                'level': 'INFO',
                'propagate': False,
            },
        },
    }
