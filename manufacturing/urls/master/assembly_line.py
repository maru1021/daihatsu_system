from django.urls import path
from manufacturing.views.master.assembly_line import AssemblyLineView, AssemblyLineExcelView, AssemblyLinePDFView

urlpatterns = [
    path('', AssemblyLineView.as_view(), name='assembly_line_master'),
    path('<int:pk>/', AssemblyLineView.as_view(), name='assembly_line_master_pk'),
    path('edit/<int:pk>/', AssemblyLineView.as_view(), name='assembly_line_edit'),
    path('delete/<int:pk>/', AssemblyLineView.as_view(), name='assembly_line_delete'),
    path('import-excel/', AssemblyLineExcelView.as_view(), name='assembly_line_import_excel'),
    path('export-excel/', AssemblyLineExcelView.as_view(), name='assembly_line_export_excel'),
    path('export-pdf/', AssemblyLinePDFView.as_view(), name='assembly_line_export_pdf'),
]
