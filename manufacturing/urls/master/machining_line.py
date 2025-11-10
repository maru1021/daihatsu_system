from django.urls import path
from manufacturing.views.master.machining_line import MachiningLineView, MachiningLineExcelView, MachiningLinePDFView

urlpatterns = [
    path('', MachiningLineView.as_view(), name='machining_line_master'),
    path('<int:pk>/', MachiningLineView.as_view(), name='machining_line_master_pk'),
    path('edit/<int:pk>/', MachiningLineView.as_view(), name='machining_line_edit'),
    path('delete/<int:pk>/', MachiningLineView.as_view(), name='machining_line_delete'),
    path('import-excel/', MachiningLineExcelView.as_view(), name='machining_line_import_excel'),
    path('export-excel/', MachiningLineExcelView.as_view(), name='machining_line_export_excel'),
    path('export-pdf/', MachiningLinePDFView.as_view(), name='machining_line_export_pdf'),
]
