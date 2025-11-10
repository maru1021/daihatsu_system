from django.urls import path
from management_room.views.master.department import DepartmentMasterView

urlpatterns = [
    path('', DepartmentMasterView.as_view(), name='department_master'),
    path('<int:pk>/', DepartmentMasterView.as_view(), name='department_master_pk'),
    path('edit/<int:pk>/', DepartmentMasterView.as_view(), name='department_edit'),
    path('delete/<int:pk>/', DepartmentMasterView.as_view(), name='department_delete'),
]
