from django.urls import path
from manufacturing.views.master.cvt_machine import CVTMachineView, CVTMachineExcelView

urlpatterns = [
    path('', CVTMachineView.as_view(), name='cvt_machine_master'),
    path('<int:pk>/', CVTMachineView.as_view(), name='cvt_machine_master_pk'),
    path('edit/<int:pk>/', CVTMachineView.as_view(), name='cvt_machine_edit'),
    path('delete/<int:pk>/', CVTMachineView.as_view(), name='cvt_machine_delete'),
    path('import-excel/', CVTMachineExcelView.as_view(), name='cvt_machine_import_excel'),
    path('export-excel/', CVTMachineExcelView.as_view(), name='cvt_machine_export_excel'),
]
