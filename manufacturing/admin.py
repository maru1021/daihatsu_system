from django.contrib import admin
from manufacturing import models

admin.site.register(models.Line)
admin.site.register(models.AssemblyLine)
admin.site.register(models.MachiningLine)
admin.site.register(models.CastingLine)
admin.site.register(models.MachiningMachine)
admin.site.register(models.MachiningToolNo)
admin.site.register(models.CastingMachine)
