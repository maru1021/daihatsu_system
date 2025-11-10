from django.urls import path
from manufacturing.views.master.machining_machine import MachiningMachineView, MachiningMachineExcelView

urlpatterns = [
    path('', MachiningMachineView.as_view(), name='machining_machine_master'),
    path('<int:pk>/', MachiningMachineView.as_view(), name='machining_machine_master_pk'),
    path('edit/<int:pk>/', MachiningMachineView.as_view(), name='machining_machine_edit'),
    path('delete/<int:pk>/', MachiningMachineView.as_view(), name='machining_machine_delete'),
    path('import-excel/', MachiningMachineExcelView.as_view(), name='machining_machine_import_excel'),
    path('export-excel/', MachiningMachineExcelView.as_view(), name='machining_machine_export_excel'),
]
