import json
import logging
from datetime import datetime, date
from decimal import Decimal
from django.db.models.signals import pre_delete, pre_save, post_save
from django.dispatch import receiver
from django.apps import apps
from django.core.serializers.json import DjangoJSONEncoder

# SQLログ用のロガー
sql_restore_logger = logging.getLogger('sql_restore')

# 除外するテーブル（現在のSQLFilterと同じロジック）
EXCLUDED_TABLES = [
    'django_session',
    'django_content_type',
    'django_migrations',
    'auth_permission',
    'daihatsu_resource',
    'daihatsu_ipblock',
]

# 除外するモデル（アプリ名.モデル名）
EXCLUDED_MODELS = [
    'sessions.session',
    'contenttypes.contenttype',
    'migrations.migration',
    'auth.permission',
]

def should_log_model(model):
    """モデルをログに記録すべきかチェック"""
    table_name = model._meta.db_table.lower()
    model_name = f"{model._meta.app_label}.{model._meta.model_name}".lower()

    # 除外テーブルチェック
    if table_name in EXCLUDED_TABLES:
        return False

    # 除外モデルチェック
    if model_name in EXCLUDED_MODELS:
        return False

    return True

def model_to_dict(instance):
    """モデルインスタンスを辞書に変換（JSON化可能な形式）"""
    data = {}
    for field in instance._meta.fields:
        # ForeignKeyの場合はデータベースカラム名（_id付き）を使用
        if field.is_relation and field.many_to_one:
            # 例: line フィールド → line_id カラム
            column_name = field.column  # データベースの実際のカラム名
            value = getattr(instance, field.attname)  # field.attname = 'line_id'
        else:
            column_name = field.name
            value = getattr(instance, field.name)
            # DateTimeやその他の特殊型をJSON化可能な形式に変換
            if hasattr(value, 'isoformat'):
                value = value.isoformat()

        data[column_name] = value
    return data

def sql_escape_value(value):
    """SQL用に値をエスケープ"""
    if value is None:
        return 'NULL'
    elif isinstance(value, bool):
        return 'true' if value else 'false'
    elif isinstance(value, (int, float, Decimal)):
        return str(value)
    elif isinstance(value, (datetime, date)):
        return f"'{value.isoformat()}'"
    elif isinstance(value, str):
        # シングルクォートをエスケープ
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    else:
        # その他はJSON文字列として扱う
        return f"'{json.dumps(value)}'"

def generate_insert_sql(table_name, data):
    """INSERT文を生成（DELETE復元用）"""
    columns = []
    values = []

    for key, value in data.items():
        columns.append(f'"{key}"')
        values.append(sql_escape_value(value))

    columns_str = ', '.join(columns)
    values_str = ', '.join(values)

    return f'INSERT INTO "{table_name}" ({columns_str}) VALUES ({values_str});'

def generate_update_sql(table_name, pk, data):
    """UPDATE文を生成（UPDATE復元用）"""
    set_parts = []

    for key, value in data.items():
        if key != 'id':  # idは更新しない
            set_parts.append(f'"{key}" = {sql_escape_value(value)}')

    set_str = ', '.join(set_parts)

    return f'UPDATE "{table_name}" SET {set_str} WHERE "id" = {pk};'

@receiver(pre_delete)
def log_before_delete(sender, instance, **kwargs):
    """削除前のデータをログに記録"""
    try:
        # 除外チェック
        if not should_log_model(sender):
            return

        from daihatsu.middleware import get_current_user, get_current_request, get_client_ip

        # IPアドレスを取得
        try:
            request = get_current_request()
            if request:
                client_ip = get_client_ip(request)
            else:
                client_ip = "不明"
        except:
            client_ip = "不明"

        # ユーザー情報を取得
        try:
            user = get_current_user()
            if user and hasattr(user, 'username'):
                user_info = f"{user.username} (ID: {user.id})"
            else:
                user_info = "Anonymous (ID: None)"
        except:
            user_info = "System (ID: None)"

        # DELETE文を生成
        table_name = sender._meta.db_table
        pk = instance.pk
        delete_sql = f'DELETE FROM "{table_name}" WHERE "id" = {pk};'

        # コメント付きでログに記録
        log_message = (
            f"-- [DELETE] IP: {client_ip} - User: {user_info} - {datetime.now().isoformat()}\n"
            f"{delete_sql}"
        )

        sql_restore_logger.info(log_message)

    except Exception:
        # エラーが発生してもデータ削除は継続
        pass

@receiver(pre_save)
def log_before_update(sender, instance, **kwargs):
    """更新前のデータをログに記録（新規作成時は除外）"""
    try:
        # 除外チェック
        if not should_log_model(sender):
            return

        # 新規作成の場合はスキップ（INSERTは既存のログで記録される）
        if instance.pk is None:
            return

        # データベースから現在の値を取得
        try:
            old_instance = sender.objects.get(pk=instance.pk)
        except sender.DoesNotExist:
            # レコードが存在しない場合は新規作成
            return

        from daihatsu.middleware import get_current_user, get_current_request, get_client_ip

        # 変更前と変更後のデータを取得
        old_data = model_to_dict(old_instance)
        new_data = model_to_dict(instance)

        # 変更があったフィールドのみ抽出
        changed_fields = {}
        for key in old_data:
            if old_data[key] != new_data[key]:
                changed_fields[key] = {
                    'old': old_data[key],
                    'new': new_data[key]
                }

        # 変更がない場合はログに記録しない
        if not changed_fields:
            return

        # last_login の更新のみの場合は除外
        if sender._meta.db_table == 'daihatsu_customuser' and list(changed_fields.keys()) == ['last_login']:
            return

        # IPアドレスを取得
        try:
            request = get_current_request()
            if request:
                client_ip = get_client_ip(request)
            else:
                client_ip = "不明"
        except:
            client_ip = "不明"

        # ユーザー情報を取得
        try:
            user = get_current_user()
            if user and hasattr(user, 'username'):
                user_info = f"{user.username} (ID: {user.id})"
            else:
                user_info = "Anonymous (ID: None)"
        except:
            user_info = "System (ID: None)"

        # 実行可能なUPDATE文を生成（変更後の値に更新）
        table_name = sender._meta.db_table
        pk = instance.pk
        update_sql = generate_update_sql(table_name, pk, new_data)

        # コメント付きでログに記録
        log_message = (
            f"-- [UPDATE] IP: {client_ip} - User: {user_info} - {datetime.now().isoformat()}\n"
            f"-- Changed fields: {', '.join(changed_fields.keys())}\n"
            f"{update_sql}"
        )

        sql_restore_logger.info(log_message)

    except Exception:
        # エラーが発生してもデータ更新は継続
        pass

@receiver(post_save)
def log_after_insert(sender, instance, created, **kwargs):
    """新規作成時のデータをログに記録"""
    try:
        # 除外チェック
        if not should_log_model(sender):
            return

        # 更新の場合はスキップ（pre_saveで記録済み）
        if not created:
            return

        from daihatsu.middleware import get_current_user, get_current_request, get_client_ip

        # 作成されたデータを取得
        data = model_to_dict(instance)

        # IPアドレスを取得
        try:
            request = get_current_request()
            if request:
                client_ip = get_client_ip(request)
            else:
                client_ip = "不明"
        except:
            client_ip = "不明"

        # ユーザー情報を取得
        try:
            user = get_current_user()
            if user and hasattr(user, 'username'):
                user_info = f"{user.username} (ID: {user.id})"
            else:
                user_info = "Anonymous (ID: None)"
        except:
            user_info = "System (ID: None)"

        # 実行可能なINSERT文を生成
        table_name = sender._meta.db_table
        insert_sql = generate_insert_sql(table_name, data)

        # コメント付きでログに記録
        log_message = (
            f"-- [INSERT] IP: {client_ip} - User: {user_info} - {datetime.now().isoformat()}\n"
            f"{insert_sql}"
        )

        sql_restore_logger.info(log_message)

    except Exception:
        # エラーが発生してもデータ作成は継続
        pass
