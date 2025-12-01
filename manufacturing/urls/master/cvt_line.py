

from django.urls import path
from manufacturing.views.master.cvt_line import CVTLineView, CVTLineExcelView, CVTLinePDFView

urlpatterns = [
    path('', CVTLineView.as_view(), name='cvt_line_master'),
    path('<int:pk>/', CVTLineView.as_view(), name='cvt_line_master_pk'),
    path('edit/<int:pk>/', CVTLineView.as_view(), name='cvt_line_edit'),
    path('delete/<int:pk>/', CVTLineView.as_view(), name='cvt_line_delete'),
    path('import-excel/', CVTLineExcelView.as_view(), name='cvt_line_import_excel'),
    path('export-excel/', CVTLineExcelView.as_view(), name='cvt_line_export_excel'),
    path('export-pdf/', CVTLinePDFView.as_view(), name='cvt_line_export_pdf'),
]
