from django.contrib import admin
import manufacturing.models

admin.site.register(manufacturing.models.Line)
admin.site.register(manufacturing.models.AssemblyLine)
admin.site.register(manufacturing.models.MachiningLine)
admin.site.register(manufacturing.models.CastingLine)
admin.site.register(manufacturing.models.MachiningMachine)
admin.site.register(manufacturing.models.MachiningToolNo)
admin.site.register(manufacturing.models.CastingMachine)
