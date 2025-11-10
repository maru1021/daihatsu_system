from django.urls import path
from management_room.views.master.employee import EmployeeMasterView

urlpatterns = [
    path('', EmployeeMasterView.as_view(), name='employee_master'),
    path('<int:pk>/', EmployeeMasterView.as_view(), name='employee_master_pk'),
    path('edit/<int:pk>/', EmployeeMasterView.as_view(), name='employee_edit'),
    path('delete/<int:pk>/', EmployeeMasterView.as_view(), name='employee_delete'),
]
