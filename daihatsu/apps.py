from django.apps import AppConfig
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from .jobs.scripts.resource_check import resource_check
from daihatsu.log import job_logger
from .jobs.jobs import job_register

scheduler = BackgroundScheduler()

class DaihatsuConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'daihatsu'

    def ready(self):
        # ジョブ登録
        job_register()

        # シグナル登録（データ復元用ログ）
        import daihatsu.signals
