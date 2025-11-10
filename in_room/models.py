from django.db import models
from management_room.models import Employee

class InRoom(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, verbose_name='従業員')
    in_room_time = models.TimeField(null=True, blank=True, verbose_name='入室時間')
    annual_leave = models.BooleanField(default=False, verbose_name='年休')
    morning_annual_leave = models.BooleanField(default=False, verbose_name='午前年休')
    afternoon_annual_leave = models.BooleanField(default=False, verbose_name='午後年休')
    business_trip = models.BooleanField(default=False, verbose_name='出張')

    class Meta:
      verbose_name = '入室管理'
      verbose_name_plural = '入室管理'

    def __str__(self):
        return f"{self.employee.name} ({self.employee.employee_number})"

    @property
    def is_in_room(self):
        """入室中かどうかを判定"""
        return self.in_room_time is not None


class Schedule(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, verbose_name='従業員', db_index=True)
    title = models.TextField(verbose_name='タイトル')
    start_time = models.TimeField(verbose_name='開始時間')
    end_time = models.TimeField(verbose_name='終了時間')
    place = models.CharField(verbose_name="場所", max_length=100, null=True, blank=True)

    class Meta:
      verbose_name = '予定'
      verbose_name_plural = '予定'

    def __str__(self):
        return f"{self.employee.name} ({self.title})"
