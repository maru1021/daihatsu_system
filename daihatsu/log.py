import logging
import os
from datetime import datetime

# ログディレクトリの作成
log_dir = 'log'
if not os.path.exists(log_dir):
    os.makedirs(log_dir)

# IPアドレスとユーザー名をログレコードに追加するカスタムフィルター
class IPAddressFilter(logging.Filter):
    """すべてのログレコードにクライアントIPアドレスとユーザー名を追加"""
    def filter(self, record):
        # 循環インポートを避けるため、ここでインポート
        from daihatsu.middleware import get_client_ip, get_current_request, get_current_user

        request = get_current_request()
        if request:
            record.client_ip = get_client_ip(request)
        else:
            record.client_ip = 'N/A'

        # ユーザー名を取得
        user = get_current_user()
        if user and hasattr(user, 'username'):
            record.username = user.username
        else:
            record.username = 'Anonymous'

        return True

# ロガーの設定
def setup_logger(name, log_file, level=logging.ERROR):
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # ファイルハンドラの設定
    file_handler = logging.FileHandler(
        os.path.join(log_dir, log_file),
        encoding='utf-8'
    )
    file_handler.setLevel(level)

    # フォーマッタの設定（CSV形式、IPアドレスとユーザー名追加）
    formatter = logging.Formatter(
        '%(asctime)s,%(client_ip)s,%(username)s,%(name)s,%(levelname)s,%(message)s'
    )
    file_handler.setFormatter(formatter)

    # IPアドレスフィルターを追加
    ip_filter = IPAddressFilter()
    file_handler.addFilter(ip_filter)

    # ハンドラの追加
    logger.addHandler(file_handler)

    return logger

# エラーロガーの作成
error_logger = setup_logger('error_logger', 'error.log')

# 各PC処理用エラーロガーの作成
local_error_logger = setup_logger('local_error_logger', 'local_error.log')

# アクセスロガーの作成
access_logger = setup_logger('access_logger', 'access.log', level=logging.INFO)

# ジョブロガーの作成
job_logger = setup_logger('job_logger', 'job.log', level=logging.INFO)

# 入力ミスロガーの作成
input_error_logger = setup_logger('input_error_logger', 'input_error.log', level=logging.INFO)

#  資源管理ロガーの作成
resource_logger = setup_logger('resource_logger', 'resource.log', level=logging.INFO)

# セキュリティロガーの作成（認証、認可、CSRF等）
security_logger = setup_logger('security_logger', 'security.log', level=logging.INFO)
# セキュリティログ用のフォーマッタを設定（IPアドレスとユーザー名追加）
security_formatter = logging.Formatter(
    '%(asctime)s,%(client_ip)s,%(username)s,%(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
security_logger.handlers[0].setFormatter(security_formatter)

# パフォーマンスロガーの作成（API応答時間、ビュー処理時間等）
performance_logger = setup_logger('performance_logger', 'performance.log', level=logging.INFO)
# パフォーマンスログ用のフォーマッタを設定（IPアドレスとユーザー名追加）
performance_formatter = logging.Formatter(
    '%(asctime)s,%(client_ip)s,%(username)s,%(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
performance_logger.handlers[0].setFormatter(performance_formatter)
