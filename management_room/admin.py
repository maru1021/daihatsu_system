from django.contrib import admin
from management_room import models

admin.site.register(models.Department)
admin.site.register(models.Employee)
admin.site.register(models.DepartmentEmployee)
admin.site.register(models.AkashiOrderList)
admin.site.register(models.MonthlyAssemblyProductionPlan)
admin.site.register(models.DailyAssenblyProductionPlan)
admin.site.register(models.DailyMachiningProductionPlan)
admin.site.register(models.DailyCastingProductionPlan)
admin.site.register(models.DailyMachineCastingProductionPlan)
admin.site.register(models.MachiningStock)
admin.site.register(models.AssemblyItem)
admin.site.register(models.MachiningItem)
admin.site.register(models.CastingItem)
