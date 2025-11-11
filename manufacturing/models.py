from django.db import models
from django.conf import settings

from daihatsu.models import MasterMethodMixin
from daihatsu.middleware import request_cache


class Line(MasterMethodMixin, models.Model):
    id = models.AutoField('ID', primary_key=True)
    name = models.CharField('ライン名', max_length=100, db_index=True)
    occupancy_rate = models.FloatField('稼働率', null=True, blank=True, default=0)
    active = models.BooleanField('アクティブ', default=True)
    last_updated_user = models.CharField('最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = 'ライン'
        verbose_name_plural = 'ライン'
        ordering = ['-active', 'name']
        indexes = [
            # 必要最小限のインデックス
            models.Index(fields=['name']),
            models.Index(fields=['active', 'name']),
        ]


class AssemblyLine(Line):
    tact = models.FloatField('タクト', null=True, blank=True, default=0)

    class Meta:
        verbose_name = '組付ライン'
        verbose_name_plural = '組付ライン'


class MachiningLine(Line):
    assembly = models.ForeignKey(AssemblyLine, on_delete=models.CASCADE, verbose_name='組付ライン', related_name='machining_lines', null=True, blank=True)
    yield_rate = models.FloatField('良品率', null=True, blank=True, default=0)
    tact = models.FloatField('タクト', null=True, blank=True, default=0)

    class Meta:
        verbose_name = '加工ライン'
        verbose_name_plural = '加工ライン'


class CastingLine(Line):
    class Meta:
        verbose_name = '鋳造ライン'
        verbose_name_plural = '鋳造ライン'

class Machine(MasterMethodMixin, models.Model):
    id = models.AutoField('ID', primary_key=True)
    name = models.CharField('設備名', max_length=100, db_index=True)
    line = models.ForeignKey(Line, on_delete=models.CASCADE, verbose_name='ライン', related_name='machines')
    active = models.BooleanField('アクティブ', default=True)
    last_updated_user = models.CharField('最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = '設備'
        verbose_name_plural = '設備'
        ordering = ['-active', 'line__name', 'name']
        indexes = [
            # 必要最小限のインデックス
            models.Index(fields=['name']),
            models.Index(fields=['active', 'name']),
            models.Index(fields=['line', 'active']),
        ]

    def __str__(self):
        return f"{self.line.name} - {self.name}"

    @classmethod
    def validate_name_unique(cls, line, name, exclude_id=None):
        query = cls.objects.filter(name=name, active=True, line=line)
        if exclude_id:
            query = query.exclude(id=exclude_id)
        return query.exists()

    @classmethod
    def get_by_name(cls, line, name, exclude_id=None):
        query = cls.objects.filter(line=line, name=name, active=True)
        if exclude_id:
            query = query.exclude(id=exclude_id)
        return query.first()

    @classmethod
    @request_cache
    def cache_get_by_name(cls, line, name, exclude_id=None):
        return cls.get_by_name(line, name, exclude_id)


class MachiningMachine(Machine):
    class Meta:
        verbose_name = '加工機'
        verbose_name_plural = '加工機'


class CastingMachine(Machine):
    class Meta:
        verbose_name = '鋳造機'
        verbose_name_plural = '鋳造機'


class MachiningToolNo(MasterMethodMixin, models.Model):
    id = models.AutoField('ID', primary_key=True)
    name = models.CharField('ツールNo', max_length=100, db_index=True)
    line = models.ForeignKey(MachiningLine, on_delete=models.CASCADE, verbose_name='ライン', related_name='tool_nos')
    machine = models.ForeignKey(MachiningMachine, on_delete=models.CASCADE, verbose_name='加工機', related_name='tool_nos')
    active = models.BooleanField('アクティブ', default=True)
    last_updated_user = models.CharField('最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = 'ツールNo'
        verbose_name_plural = 'ツールNo'
        ordering = ['-active', 'line__name', 'machine__name', 'name']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['active', 'name']),
            models.Index(fields=['machine', 'active']),
            models.Index(fields=['line', 'active']),
        ]

    def __str__(self):
        return f"{self.line.name} - {self.machine.name} - {self.name}"

    @classmethod
    def validate_name_unique(cls, machine, name, exclude_id=None):
        query = cls.objects.filter(name=name, active=True, machine=machine)
        if exclude_id:
            query = query.exclude(id=exclude_id)
        return query.exists()

    @classmethod
    def get_by_name(cls, machine, name):
        return cls.objects.filter(machine=machine, name=name, active=True).first()

    @classmethod
    @request_cache
    def cache_get_by_name(cls, machine, name):
        return cls.get_by_name(machine, name)
