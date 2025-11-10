from django.db import models
from daihatsu.models import CustomUser
from management_room.models import Department, Employee
from manufacturing.models import Line

class ActualProductionItem(models.Model):
    code = models.CharField(verbose_name='コード', max_length=100)
    name = models.CharField(verbose_name='名前', max_length=100)
    active = models.BooleanField(verbose_name='有効', default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = '実績生産品目'
        verbose_name_plural = '実績生産品目'
        ordering = ['-active', 'code', 'name']
        indexes = [
            models.Index(fields=['active', 'name']),
            models.Index(fields=['active', 'code']),
        ]

    def __str__(self):
        return self.name

class AttendanceSelect(models.Model):
    name = models.CharField(verbose_name='勤怠選択肢', max_length=100)
    active = models.BooleanField(verbose_name='有効', default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)
    order = models.IntegerField(verbose_name='並び順', default=0)

    class Meta:
        verbose_name = '勤怠選択'
        verbose_name_plural = '勤怠選択'
        ordering = ['-active', 'order', 'name']
        indexes = [
            models.Index(fields=['active', 'name']),
        ]

    def __str__(self):
        return self.name

class AttendanceProductionMapping(models.Model):
    attendance_select = models.ForeignKey(AttendanceSelect, verbose_name='勤怠選択肢', on_delete=models.CASCADE)
    actual_production_item = models.ForeignKey(ActualProductionItem, verbose_name='実績生産品目', on_delete=models.CASCADE)
    active = models.BooleanField(verbose_name='有効', default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = '勤怠選択肢-実績生産品目紐づけ'
        verbose_name_plural = '勤怠選択肢-実績生産品目紐づけ'
        ordering = ['attendance_select__order', 'attendance_select__name', 'actual_production_item__code']
        unique_together = [['attendance_select', 'actual_production_item']]
        indexes = [
            models.Index(fields=['attendance_select', 'active']),
            models.Index(fields=['actual_production_item', 'active']),
        ]

    def __str__(self):
        return f"{self.attendance_select.name} - {self.actual_production_item.name}"


class AttendanceRecord(models.Model):
    """勤怠記録（メインレコード）"""
    SHIFT_CHOICES = [
        ('day', '日勤'),
        ('night', '夜勤'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, verbose_name='従業員')
    attendance_date = models.DateField(verbose_name='勤怠日')
    shift_type = models.CharField(max_length=10, choices=SHIFT_CHOICES, default='day', verbose_name='勤務区分')
    start_time = models.TimeField(verbose_name='開始時間')
    end_time = models.TimeField(verbose_name='終了時間')
    own_line_operation_hours = models.DecimalField(max_digits=4, decimal_places=1, default=0, verbose_name='自ライン稼働時間')
    production_overtime = models.DecimalField(max_digits=4, decimal_places=1, default=0, verbose_name='生産残業時間')
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        unique_together = ['employee', 'attendance_date']
        verbose_name = '勤怠記録'
        verbose_name_plural = '勤怠記録'
        ordering = ['-attendance_date']
        indexes = [
            models.Index(fields=['employee', 'attendance_date']),
            models.Index(fields=['attendance_date']),
        ]

    def __str__(self):
        return f"{self.employee.name} - {self.attendance_date}"


class AttendanceTask(models.Model):
    """業務内容（0以外の時間のみ保存）"""
    attendance_record = models.ForeignKey(AttendanceRecord, on_delete=models.CASCADE, related_name='tasks', verbose_name='勤怠記録')
    attendance_select = models.ForeignKey(AttendanceSelect, on_delete=models.CASCADE, verbose_name='勤怠選択肢')
    hours = models.DecimalField(max_digits=4, decimal_places=1, verbose_name='時間')
    overtime = models.BooleanField(default=False, verbose_name='残業')

    class Meta:
        verbose_name = '業務内容'
        verbose_name_plural = '業務内容'
        ordering = ['attendance_select__order', 'attendance_select__name']

    def __str__(self):
        return f"{self.attendance_record.employee.name} - {self.attendance_select.name} ({self.hours}h)"


class AttendanceSupport(models.Model):
    """応援（0以外の時間のみ保存）"""
    attendance_record = models.ForeignKey(AttendanceRecord, on_delete=models.CASCADE, related_name='supports', verbose_name='勤怠記録')
    line = models.ForeignKey(Line, on_delete=models.CASCADE, verbose_name='応援ライン')
    hours = models.DecimalField(max_digits=4, decimal_places=1, verbose_name='時間')
    overtime = models.BooleanField(default=False, verbose_name='残業')

    class Meta:
        verbose_name = '応援'
        verbose_name_plural = '応援'
        ordering = ['line__name']

    def __str__(self):
        return f"{self.attendance_record.employee.name} - {self.line.name} ({self.hours}h)"
