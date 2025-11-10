from django.contrib import admin
from .models import Department, Employee, DepartmentEmployee, AkashiOrderList

admin.site.register(Department)
admin.site.register(Employee)
admin.site.register(DepartmentEmployee)
admin.site.register(AkashiOrderList)
