from django.contrib import admin
import actual_production.models as models

admin.site.register(models.ActualProductionItem)
admin.site.register(models.AttendanceSelect)
admin.site.register(models.AttendanceProductionMapping)
admin.site.register(models.AttendanceRecord)
admin.site.register(models.AttendanceTask)
admin.site.register(models.AttendanceSupport)
