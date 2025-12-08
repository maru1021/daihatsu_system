from django.db import models
from django.conf import settings
from daihatsu.models import MasterMethodMixin


class Department(models.Model):
    name = models.CharField(verbose_name="部署名", max_length=100, db_index=True)
    code = models.CharField(verbose_name="部署コード", max_length=20, db_index=True)
    parent = models.ForeignKey('self', on_delete=models.CASCADE, verbose_name="親部署", null=True, blank=True, related_name='children')
    manager = models.ForeignKey('Employee', on_delete=models.SET_NULL, verbose_name="部署長", null=True, blank=True, related_name='managed_departments')
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "部署"
        verbose_name_plural = "部署"
        ordering = ['-active', 'code', 'name']
        indexes = [
            models.Index(fields=['active', 'name']),
            models.Index(fields=['active', 'code']),
        ]

    def __str__(self):
        return f"{self.name}"

class Employee(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name='ユーザー', related_name='employee', null=True, blank=True)
    employee_number = models.CharField(verbose_name="従業員番号", max_length=100, db_index=True)
    name = models.CharField(verbose_name="名前", max_length=100, db_index=True)
    email = models.EmailField(verbose_name="メールアドレス", max_length=100, null=True, blank=True)
    phone_number = models.CharField(verbose_name="内線番号", max_length=100, null=True, blank=True)
    card_no = models.CharField(verbose_name="カードNo", max_length=15, null=True, blank=True)
    line = models.ForeignKey('manufacturing.Line', on_delete=models.CASCADE, verbose_name="ライン", null=True, blank=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)
    in_room = models.BooleanField(verbose_name="在籍管理", default=False)

    class Meta:
        verbose_name = "従業員"
        verbose_name_plural = "従業員"
        ordering = ['employee_number']

    def __str__(self):
        return f"{self.employee_number} - {self.name}"

    def save(self, *args, **kwargs):
        # 既存レコードの場合、社員番号が変更されたかチェック
        if self.pk:
            try:
                old_employee = Employee.objects.get(pk=self.pk)
                # 社員番号が変更された場合、ユーザー名も更新
                if old_employee.employee_number != self.employee_number and self.user:
                    self.user.username = self.employee_number
                    self.user.save()
            except Employee.DoesNotExist:
                pass
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        # 関連データを削除
        if self.user:
            self.user.delete()
        super().delete(*args, **kwargs)

    # 現在所属している部署
    @property
    def departments(self):
        return Department.objects.filter(department_employee__employee=self, department_employee__leave_date__isnull=True)


class DepartmentEmployee(models.Model):
    department = models.ForeignKey(Department, on_delete=models.CASCADE, verbose_name='部署', related_name='department_employee', db_index=True)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, verbose_name='従業員', related_name='department_employee', db_index=True)
    transfer_date = models.DateField(verbose_name="異動日", null=True, blank=True)
    leave_date = models.DateField(verbose_name="部署離脱日", null=True, blank=True)
    notes = models.TextField(verbose_name="備考", null=True, blank=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "部署所属履歴"
        verbose_name_plural = "部署所属履歴"
        ordering = ['-transfer_date']

    def __str__(self):
        status = "在籍中" if not self.leave_date else "離脱済み"
        return f"{self.employee} - {self.department} ({status})"


class AkashiOrderList(models.Model):
    no = models.IntegerField(verbose_name='No', null=True, blank=True)
    data_classification = models.CharField(verbose_name='データ区分', max_length=10, null=True, blank=True)
    order_classification = models.IntegerField(verbose_name='発注区分', null=True, blank=True)
    delivery_number = models.CharField(verbose_name='納番', max_length=10, null=True, blank=True)
    acceptance = models.IntegerField(verbose_name='受入', null=True, blank=True)
    jersey_number = models.IntegerField(verbose_name='背番号', null=True, blank=True)
    product_number = models.CharField(verbose_name='品番', max_length=20, null=True, blank=True)
    delivery_date = models.DateField(verbose_name="納入日", null=True, blank=True, db_index=True)
    flight = models.IntegerField(verbose_name='便', null=True, blank=True)
    capacity = models.IntegerField(verbose_name='収容数', null=True, blank=True)
    box_quantity = models.IntegerField(verbose_name='箱数', null=True, blank=True)
    quantity = models.IntegerField(verbose_name='数量', null=True, blank=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "明石発注データリスト"
        verbose_name_plural = "明石発注データリスト"
        ordering = ['-delivery_date', 'flight', 'no']
        indexes = [
                    models.Index(fields=['product_number', 'delivery_date']),
                ]


    def __str__(self):
        return f"{self.delivery_date} - {self.flight} - {self.no}"

class AssemblyItem(MasterMethodMixin, models.Model):
    name = models.CharField(verbose_name="完成品番", max_length=100, db_index=True)
    line = models.ForeignKey('manufacturing.AssemblyLine', on_delete=models.CASCADE, verbose_name="組立ライン", null=True, blank=True, db_index=True)
    main_line = models.BooleanField(verbose_name="メインライン", default=False)
    order = models.IntegerField(verbose_name="表示順", null=True, blank=True, default=0)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "完成品番"
        verbose_name_plural = "完成品番"
        ordering = ['-active', 'line', 'order']
        indexes = [
            models.Index(fields=['active', 'name']),
        ]

    def __str__(self):
        return f"{self.name}"

class MachiningItem(MasterMethodMixin, models.Model):
    assembly_line = models.ForeignKey('manufacturing.AssemblyLine', on_delete=models.CASCADE, verbose_name="組付ライン", null=True, blank=True, db_index=True)
    line = models.ForeignKey('manufacturing.MachiningLine', on_delete=models.CASCADE, verbose_name="加工ライン", null=True, blank=True, db_index=True)
    name = models.CharField(verbose_name="品番", max_length=100, null=True, blank=True)
    main_line = models.BooleanField(verbose_name="メインライン", default=False)
    order = models.IntegerField(verbose_name="表示順", null=True, blank=True, default=0)
    optimal_inventory = models.IntegerField(verbose_name="適正在庫数", null=True, blank=True, default=0)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "加工品番"
        verbose_name_plural = "加工品番"
        ordering = ['-active', 'assembly_line', 'line', 'name']
        indexes = [
            models.Index(fields=['line', 'active', 'order']),
        ]

    def __str__(self):
        return f"{self.line.name} - {self.name}"

class CastingItem(MasterMethodMixin, models.Model):
    line = models.ForeignKey('manufacturing.CastingLine', on_delete=models.CASCADE, verbose_name="鋳造ライン", null=True, blank=True, db_index=True)
    name = models.CharField(verbose_name="品番", max_length=100, null=True, blank=True)
    order = models.IntegerField(verbose_name="表示順", null=True, blank=True, default=0)
    optimal_inventory = models.IntegerField(verbose_name="適正在庫数", null=True, blank=True, default=0)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)
    molten_metal_usage = models.FloatField(verbose_name="溶湯使用量", null=True, blank=True, default=0)

    class Meta:
        verbose_name = "鋳造品番"
        verbose_name_plural = "鋳造品番"
        ordering = ['-active', 'line', 'order']
        indexes = [
            models.Index(fields=['line', 'active', 'name']),
        ]

    def __str__(self):
        return f"{self.line.name} - {self.name}"

class CVTItem(MasterMethodMixin, models.Model):
    line = models.ForeignKey('manufacturing.CVTLine', on_delete=models.CASCADE, verbose_name="CVTライン", null=True, blank=True, db_index=True)
    name = models.CharField(verbose_name="品番", max_length=100, null=True, blank=True)
    order = models.IntegerField(verbose_name="表示順", null=True, blank=True, default=0)
    optimal_inventory = models.IntegerField(verbose_name="適正在庫数", null=True, blank=True, default=0)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)
    molten_metal_usage = models.FloatField(verbose_name="溶湯使用量", null=True, blank=True, default=0)

    class Meta:
        verbose_name = "CVT品番"
        verbose_name_plural = "CVT品番"
        ordering = ['-active', 'line', 'order']
        indexes = [
            models.Index(fields=['line', 'active', 'name']),
        ]

    def __str__(self):
        return f"{self.line.name} - {self.name}"


class CastingItemProhibitedPattern(models.Model):
    line = models.ForeignKey('manufacturing.CastingLine', on_delete=models.CASCADE, verbose_name="鋳造ライン", null=True, blank=True, db_index=True)
    item_name1 = models.ForeignKey(CastingItem, on_delete=models.CASCADE, verbose_name="品番1", related_name='casting_item_prohibited_pattern_item1', null=True, blank=True)
    item_name2 = models.ForeignKey(CastingItem, on_delete=models.CASCADE, verbose_name="品番2", related_name='casting_item_prohibited_pattern_item2', null=True, blank=True)
    count = models.IntegerField(verbose_name="同時生産上限", null=True, blank=True, default=2)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "鋳造同時生産禁止品番パターン"
        verbose_name_plural = "鋳造同時生産禁止品番パターン"
        ordering = ['-active', 'line', 'item_name1', 'item_name2']
        indexes = [
            models.Index(fields=['line', 'active']),
        ]

    def __str__(self):
        return f"{self.line.name} - {self.item_name1.name} - {self.item_name2.name}"


class CastingItemMachineMap(MasterMethodMixin, models.Model):
    line = models.ForeignKey('manufacturing.CastingLine', on_delete=models.CASCADE, verbose_name="鋳造ライン", null=True, blank=True, db_index=True)
    machine = models.ForeignKey('manufacturing.CastingMachine', on_delete=models.CASCADE, verbose_name="鋳造機", null=True, blank=True, db_index=True)
    casting_item = models.ForeignKey(CastingItem, on_delete=models.CASCADE, verbose_name="鋳造品番", null=True, blank=True, db_index=True)
    tact = models.FloatField(verbose_name="タクト", null=True, blank=True, default=0)
    yield_rate = models.FloatField(verbose_name="良品率", null=True, blank=True, default=0)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "鋳造品番-設備紐づけ"
        verbose_name_plural = "鋳造品番-設備紐づけ"
        ordering = ['-active', 'line__order', 'machine__order', 'casting_item__order']
        indexes = [
            models.Index(fields=['line', 'machine', 'casting_item', 'active']),
        ]

    def __str__(self):
        line_name = self.line.name if self.line else ''
        machine_name = self.machine.name if self.machine else ''
        item_name = self.casting_item.name if self.casting_item else ''
        return f"{line_name} - {machine_name} - {item_name}"


class CVTItemMachineMap(MasterMethodMixin, models.Model):
    line = models.ForeignKey('manufacturing.CVTLine', on_delete=models.CASCADE, verbose_name="CVTライン", null=True, blank=True, db_index=True)
    machine = models.ForeignKey('manufacturing.CVTMachine', on_delete=models.CASCADE, verbose_name="CVT鋳造機", null=True, blank=True, db_index=True)
    casting_item = models.ForeignKey(CVTItem, on_delete=models.CASCADE, verbose_name="CVT品番", null=True, blank=True, db_index=True)
    tact = models.FloatField(verbose_name="タクト", null=True, blank=True, default=0)
    yield_rate = models.FloatField(verbose_name="良品率", null=True, blank=True, default=0)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "CVT品番-設備紐づけ"
        verbose_name_plural = "CVT品番-設備紐づけ"
        ordering = ['-active', 'line__order', 'machine__order', 'casting_item__order']
        indexes = [
            models.Index(fields=['line', 'machine', 'casting_item', 'active']),
        ]

    def __str__(self):
        line_name = self.line.name if self.line else ''
        machine_name = self.machine.name if self.machine else ''
        item_name = self.casting_item.name if self.casting_item else ''
        return f"{line_name} - {machine_name} - {item_name}"


class AssemblyItemMachiningItemMap(models.Model):
    assembly_item = models.ForeignKey(AssemblyItem, on_delete=models.CASCADE, verbose_name="完成品番", related_name='assembly_item_machining_items', db_index=True)
    machining_item = models.ForeignKey(MachiningItem, on_delete=models.CASCADE, verbose_name="加工品番", related_name='assembly_item_machining_items', db_index=True)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "完成品番-加工品番紐付け"
        verbose_name_plural = "完成品番-加工品番紐付け"
        ordering = ['assembly_item', 'machining_item']
        indexes = [
            models.Index(fields=['assembly_item', 'machining_item']),
        ]

    def __str__(self):
        return f"{self.assembly_item.name} - {self.machining_item.name}"

class MachiningItemCastingItemMap(models.Model):
    machining_line_name = models.CharField(verbose_name="加工ライン名", max_length=100, null=True, blank=True, db_index=True)
    machining_item_name = models.CharField(verbose_name="加工品番名", max_length=100, null=True, blank=True, db_index=True)
    casting_line_name = models.CharField(verbose_name="鋳造ライン名", max_length=100, null=True, blank=True, db_index=True)
    casting_item_name = models.CharField(verbose_name="鋳造品番名", max_length=100, null=True, blank=True, db_index=True)
    active = models.BooleanField(verbose_name="有効", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "加工品番-鋳造品番紐付け"
        verbose_name_plural = "加工品番-鋳造品番紐付け"
        ordering = ['machining_line_name', 'machining_item_name', 'casting_line_name', 'casting_item_name']
        indexes = [
            models.Index(fields=['machining_line_name', 'machining_item_name', 'casting_line_name', 'casting_item_name']),
        ]

    def __str__(self):
        return f"{self.machining_line_name} - {self.machining_item_name} - {self.casting_line_name} - {self.casting_item_name}"


class MonthlyAssemblyProductionPlan(models.Model):
    month = models.DateField(verbose_name="月", null=True, blank=True, db_index=True)
    line = models.ForeignKey('manufacturing.AssemblyLine', on_delete=models.CASCADE, verbose_name="組付ライン", null=True, blank=True, db_index=True)
    production_item = models.ForeignKey(AssemblyItem, on_delete=models.CASCADE, verbose_name="品番", null=True, blank=True, db_index=True)
    quantity = models.IntegerField(verbose_name="数量", null=True, blank=True, default=0)
    tact = models.FloatField(verbose_name="タクト", null=True, blank=True, default=0)

    class Meta:
        verbose_name = "月別組付生産計画"
        verbose_name_plural = "月別組付生産計画"
        ordering = ['-month', 'line']
        indexes = [
            models.Index(fields=['line', 'month']),
            models.Index(fields=['line', 'month', 'production_item']),
        ]

    def __str__(self):
        return f"{self.month} - {self.line} - {self.production_item.name}"

class MonthlyCVTProductionPlan(models.Model):
    month = models.DateField(verbose_name="月", null=True, blank=True, db_index=True)
    line = models.ForeignKey('manufacturing.CVTLine', on_delete=models.CASCADE, verbose_name="CVTライン", null=True, blank=True, db_index=True)
    production_item = models.ForeignKey(CVTItem, on_delete=models.CASCADE, verbose_name="品番", null=True, blank=True, db_index=True)
    quantity = models.IntegerField(verbose_name="数量", null=True, blank=True, default=0)

    class Meta:
        verbose_name = "月別CVT生産計画"
        verbose_name_plural = "月別CVT生産計画"
        ordering = ['-month', 'line']
        indexes = [
            models.Index(fields=['line', 'month']),
            models.Index(fields=['line', 'month', 'production_item']),
        ]

    def __str__(self):
        return f"{self.month} - {self.line} - {self.production_item.name}"


class DailyAssenblyProductionPlan(models.Model):
    line = models.ForeignKey('manufacturing.AssemblyLine', on_delete=models.CASCADE, verbose_name="組付ライン", null=True, blank=True, db_index=True)
    production_item = models.ForeignKey(AssemblyItem, on_delete=models.CASCADE, verbose_name="品番", null=True, blank=True, db_index=True)
    date = models.DateField(verbose_name="日付", null=True, blank=True, db_index=True)
    shift = models.CharField(verbose_name="シフト", max_length=100, null=True, blank=True)
    production_quantity = models.IntegerField(verbose_name="生産数", null=True, blank=True, default=0)
    stop_time = models.IntegerField(verbose_name="計画停止", null=True, blank=True, default=0)
    overtime = models.IntegerField(verbose_name="生産残業", null=True, blank=True, default=0)
    occupancy_rate = models.FloatField(verbose_name="稼働率", null=True, blank=True, default=0)
    regular_working_hours = models.BooleanField(verbose_name="定時", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "日別組付生産計画"
        verbose_name_plural = "日別組付生産計画"
        ordering = ['-date']
        indexes = [
            models.Index(fields=['line', 'date','shift']),
            models.Index(fields=['line', 'date', 'shift', 'production_item']),
        ]

    def __str__(self):
        return f"{self.date} - {self.shift} - {self.production_item.name}"


class DailyMachiningProductionPlan(models.Model):
    line = models.ForeignKey('manufacturing.MachiningLine', on_delete=models.CASCADE, verbose_name="加工ライン", null=True, blank=True, db_index=True)
    production_item = models.ForeignKey(MachiningItem, on_delete=models.CASCADE, verbose_name="品番", null=True, blank=True, db_index=True)
    date = models.DateField(verbose_name="日付", null=True, blank=True, db_index=True)
    shift = models.CharField(verbose_name="シフト", max_length=100, null=True, blank=True)
    production_quantity = models.IntegerField(verbose_name="生産数", null=True, blank=True, default=0)
    stop_time = models.IntegerField(verbose_name="計画停止", null=True, blank=True, default=0)
    overtime = models.IntegerField(verbose_name="生産残業", null=True, blank=True, default=0)
    occupancy_rate = models.FloatField(verbose_name="稼働率", null=True, blank=True, default=0)
    regular_working_hours = models.BooleanField(verbose_name="定時", default=True)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "日別加工生産計画"
        verbose_name_plural = "日別加工生産計画"
        ordering = ['-date']
        indexes = [
            models.Index(fields=['line', 'date','shift']),
            models.Index(fields=['line', 'date', 'shift', 'production_item']),
        ]

    def __str__(self):
        return f"{self.date} - {self.shift} - { self.line.name} - {self.production_item.name}"


class MachiningStock(models.Model):
    line_name = models.CharField(verbose_name="ライン名", max_length=100, null=True, blank=True, db_index=True)
    item_name = models.CharField(verbose_name="品番名", max_length=100, null=True, blank=True, db_index=True)
    date = models.DateField(verbose_name="日付", null=True, blank=True, db_index=True)
    shift = models.CharField(verbose_name="シフト", max_length=100, null=True, blank=True)
    stock = models.IntegerField(verbose_name="在庫数", null=True, blank=True, default=0)
    stock_adjustment = models.IntegerField(verbose_name="在庫調整数", null=True, blank=True, default=0)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "加工在庫"
        verbose_name_plural = "加工在庫"
        ordering = ['-date', 'shift']
        indexes = [
            models.Index(fields=['line_name', 'date', 'shift']),
            models.Index(fields=['line_name', 'date', 'shift', 'item_name']),
        ]

    def __str__(self):
        return f"{self.date} - {self.shift} - {self.line_name} - {self.item_name} - {self.stock}"


# シフト、品番ごとのモデル
class DailyCastingProductionPlan(models.Model):
    line = models.ForeignKey('manufacturing.CastingLine', on_delete=models.CASCADE, verbose_name="鋳造ライン", null=True, blank=True, db_index=True)
    production_item = models.ForeignKey(CastingItem, on_delete=models.CASCADE, verbose_name="品番", null=True, blank=True, db_index=True)
    date = models.DateField(verbose_name="日付", null=True, blank=True, db_index=True)
    shift = models.CharField(verbose_name="シフト", max_length=100, null=True, blank=True)
    stock = models.IntegerField(verbose_name="在庫数", null=True, blank=True, default=0)
    stock_adjustment = models.IntegerField(verbose_name="在庫調整数", null=True, blank=True, default=0)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "日別鋳造計画"
        verbose_name_plural = "日別鋳造計画"
        ordering = ['-date']
        indexes = [
            models.Index(fields=['line', 'date','shift']),
            models.Index(fields=['line', 'date', 'shift', 'production_item']),
        ]

    def __str__(self):
        return f"{self.date} - {self.shift} - {self.production_item.name}"


# シフト、鋳造機、品番ごとのモデル
# 鋳造機ごとに作成する品番が異なるためDailyCastingProductionPlantリレーションさせない
class DailyMachineCastingProductionPlan(models.Model):
    line = models.ForeignKey('manufacturing.CastingLine', on_delete=models.CASCADE, verbose_name="鋳造ライン", related_name='daily_machine_casting_production_plans')
    machine = models.ForeignKey('manufacturing.CastingMachine', on_delete=models.CASCADE, verbose_name="鋳造機", related_name='daily_machine_casting_production_plans')
    date = models.DateField(verbose_name="日付", null=True, blank=True, db_index=True)
    shift = models.CharField(verbose_name="シフト", max_length=100, null=True, blank=True)
    production_item = models.ForeignKey(CastingItem, on_delete=models.CASCADE, verbose_name="品番", null=True, blank=True, db_index=True)
    production_count = models.IntegerField(verbose_name="生産数", null=True, blank=True, default=0)
    mold_change = models.IntegerField(verbose_name="金型交換", null=True, blank=True, default=0)
    stop_time = models.IntegerField(verbose_name="計画停止", null=True, blank=True, default=0)
    overtime = models.IntegerField(verbose_name="生産残業", null=True, blank=True, default=0)
    mold_count = models.IntegerField(verbose_name="金型使用数", null=True, blank=True, default=0)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)
    occupancy_rate = models.FloatField(verbose_name="稼働率", null=True, blank=True, default=0)
    regular_working_hours = models.BooleanField(verbose_name="定時", default=False)

    class Meta:
        verbose_name = "日別鋳造計画品番"
        verbose_name_plural = "日別鋳造計画品番"
        ordering = ['-date', 'shift', 'machine', 'production_item']
        indexes = [
            models.Index(fields=['date', 'shift', 'machine', 'production_item']),
        ]

    def __str__(self):
        return f"{self.date} - {self.shift} - {self.line.name if self.line else ''} - {self.machine.name if self.machine else ''} - {self.production_item.name if self.production_item else ''} - {self.production_count}"


class UsableMold(models.Model):
    end_of_month = models.BooleanField(verbose_name="月末", default=False)
    month = models.DateField(verbose_name="月", null=True, blank=True, db_index=True)
    line = models.ForeignKey('manufacturing.CastingLine', on_delete=models.CASCADE, verbose_name="鋳造ライン", null=True, blank=True, db_index=True)
    machine = models.ForeignKey('manufacturing.CastingMachine', on_delete=models.CASCADE, verbose_name="鋳造機", null=True, blank=True, db_index=True)
    item_name = models.ForeignKey(CastingItem, on_delete=models.CASCADE, verbose_name="品番", null=True, blank=True, db_index=True)
    used_count = models.IntegerField(verbose_name="使用回数", null=True, blank=True, default=0)
    last_updated_user = models.CharField(verbose_name='最終更新者', max_length=100, null=True, blank=True)

    class Meta:
        verbose_name = "金型月末、途中交換管理"
        verbose_name_plural = "金型月末、途中交換管理"
        ordering = ['month', 'line', 'machine']
        indexes = [
            models.Index(fields=['month', 'line', 'machine']),
        ]

    def __str__(self):
        return f"{self.month} - {self.line.name} - {self.machine.name} - {self.item_name.name}"
