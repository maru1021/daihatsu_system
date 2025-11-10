from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from daihatsu.jobs.scripts.resource_check import resource_check
from daihatsu.jobs.scripts.schedule_delete import schedule_delete
import logging

def job_register():
    # APSchedulerのログレベルを調整
    logging.getLogger('apscheduler').setLevel(logging.WARNING)

    scheduler = BackgroundScheduler()

    # リソースチェックジョブ
    scheduler.add_job(
        resource_check,
        trigger=IntervalTrigger(minutes=1),
        id='resource_check',
        replace_existing=True
    )

    # スケジュールの削除（毎日0時）
    scheduler.add_job(
        schedule_delete,
        trigger=CronTrigger(
            hour=0,
            minute=0
        ),
        id='schedule_delete',
        replace_existing=True
    )

    # スケジューラーを開始
    scheduler.start()
