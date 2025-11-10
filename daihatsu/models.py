from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone
from datetime import timedelta
from .middleware import request_cache


class MasterMethodMixin:
    def __str__(self):
        return self.name

    @classmethod
    def get_by_id(cls, id):
        return cls.objects.filter(id=id).first()

    @classmethod
    def get_by_name(cls, name):
        return cls.objects.filter(name=name, active=True).first()

    @classmethod
    def validate_name_unique(cls, name, exclude_id=None):
        query = cls.objects.filter(name=name, active=True)
        if exclude_id:
            query = query.exclude(id=exclude_id)
        return query.exists()

    @classmethod
    def get_active_names(cls, model=True):
        if model:
            return cls.objects.filter(active=True)
        else:
            return list(cls.objects.filter(active=True).values_list('name', flat=True).distinct())

    # リクエストキャッシュ付き
    @classmethod
    @request_cache
    def cache_get_by_id(cls, id):
        return cls.get_by_id(id)

    @classmethod
    @request_cache
    def cache_get_by_name(cls, name):
        return cls.get_by_name(name)


class CustomUser(AbstractUser):
    """カスタムユーザーモデル - 効率的なログイン失敗処理"""
    miss_count = models.IntegerField('連続失敗回数', default=0)
    locked_until = models.DateTimeField('ロック解除時刻', null=True, blank=True)

    class Meta:
        verbose_name = 'ユーザー'
        verbose_name_plural = 'ユーザー'

    def is_locked(self):
        """ユーザーがロックされているかチェック"""
        if self.locked_until and self.locked_until > timezone.now():
            return True
        elif self.locked_until and self.locked_until <= timezone.now():
            # ロック期間が過ぎた場合はクリア
            self.locked_until = None
            self.miss_count = 0
            self.save(update_fields=['locked_until', 'miss_count'])
            return False
        return False

    def increment_miss_count(self):
        """失敗カウンターを増加、必要に応じてロック"""
        self.miss_count += 1

        if self.miss_count >= 10:
            # 10回失敗でロック（10分間）
            self.locked_until = timezone.now() + timedelta(minutes=10)

        self.save(update_fields=['miss_count', 'locked_until'])
        return self.miss_count >= 10

    def reset_miss_count(self):
        """成功時に失敗カウンターをリセット"""
        if self.miss_count > 0 or self.locked_until:
            self.miss_count = 0
            self.locked_until = None
            self.save(update_fields=['miss_count', 'locked_until'])


class IPBlock(models.Model):
    """IPアドレスブロック情報"""
    ip_address = models.GenericIPAddressField('IPアドレス', unique=True)
    blocked_until = models.DateTimeField('ブロック解除時刻', null=True, blank=True)
    created_at = models.DateTimeField('作成日時', auto_now_add=True)

    # 最近のアクセス記録 (JSON形式で複数のタイムスタンプを保持)
    recent_access_times = models.JSONField('最近のアクセス時刻', default=list, blank=True)

    class Meta:
        verbose_name = 'IPブロック'
        verbose_name_plural = 'IPブロック'

    @classmethod
    def is_blocked(cls, ip_address):
        """IPアドレスがブロックされているかチェック"""
        try:
            block = cls.objects.get(ip_address=ip_address)
            if block.blocked_until > timezone.now():
                return True
            else:
                # ブロック期間が過ぎた場合は削除
                block.delete()
                return False
        except cls.DoesNotExist:
            return False

    @classmethod
    def check_and_update_access(cls, ip_address, threshold=3, time_window_seconds=0.1):
        """
        IPアドレスのアクセスをチェックし、必要に応じてブロック
        """
        now = timezone.now()

        try:
            ip_record = cls.objects.get(ip_address=ip_address)

            # 既にブロックされているかチェック
            if ip_record.blocked_until and ip_record.blocked_until > now:
                return True

            # ブロック期間が過ぎている場合はクリア
            if ip_record.blocked_until and ip_record.blocked_until <= now:
                ip_record.blocked_until = None
                ip_record.recent_access_times = []
                ip_record.save()

        except cls.DoesNotExist:
            # 新しいIPの場合は作成
            ip_record = cls.objects.create(
                ip_address=ip_address,
                blocked_until=None,
                recent_access_times=[]
            )

        # 現在の時刻を追加
        current_time = now.isoformat()
        ip_record.recent_access_times.append(current_time)

        # 指定時間より古いアクセスを削除
        cutoff_time = now - timedelta(seconds=time_window_seconds)
        ip_record.recent_access_times = [
            t for t in ip_record.recent_access_times
            if timezone.datetime.fromisoformat(t) > cutoff_time
        ]

        # 閾値チェック
        if len(ip_record.recent_access_times) >= threshold:
            # ブロック実行
            ip_record.blocked_until = now + timedelta(minutes=10)
            ip_record.save()
            return True
        else:
            # 通常の記録更新
            ip_record.save()
            return False

class Resource(models.Model):
    created_at = models.DateTimeField('作成日時', auto_now_add=True)
    active = models.BooleanField('アクティブ', default=True)
    cpu = models.FloatField('CPU使用率', default=0)
    memory = models.FloatField('メモリ使用率', default=0)
    disk = models.FloatField('ディスク使用率', default=0)

    class Meta:
        verbose_name = 'リソース'
        verbose_name_plural = 'リソース'
        ordering = ['-created_at']

    def __str__(self):
        return str(self.created_at)
