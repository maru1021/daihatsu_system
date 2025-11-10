from django.urls import path
from manufacturing.views.master.casting_machine import CastingMachineView, CastingMachineExcelView

urlpatterns = [
    path('', CastingMachineView.as_view(), name='casting_machine_master'),
    path('<int:pk>/', CastingMachineView.as_view(), name='casting_machine_master_pk'),
    path('edit/<int:pk>/', CastingMachineView.as_view(), name='casting_machine_edit'),
    path('delete/<int:pk>/', CastingMachineView.as_view(), name='casting_machine_delete'),
    path('import-excel/', CastingMachineExcelView.as_view(), name='casting_machine_import_excel'),
    path('export-excel/', CastingMachineExcelView.as_view(), name='casting_machine_export_excel'),
]
