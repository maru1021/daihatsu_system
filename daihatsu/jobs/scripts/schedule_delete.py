from daihatsu.log import job_logger

# スケジュールの削除
def schedule_delete():
    try:
        from in_room.models import Schedule
        # スケジュールの削除
        Schedule.objects.all().delete()
        job_logger.info("スケジュールを削除しました")

    except Exception as e:
        job_logger.error(f"スケジュール削除中にエラーが発生しました: {str(e)}")
        raise
