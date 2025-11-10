

from django.urls import path
from manufacturing.views.master.casting_line import CastingLineView, CastingLineExcelView, CastingLinePDFView

urlpatterns = [
    path('', CastingLineView.as_view(), name='casting_line_master'),
    path('<int:pk>/', CastingLineView.as_view(), name='casting_line_master_pk'),
    path('edit/<int:pk>/', CastingLineView.as_view(), name='casting_line_edit'),
    path('delete/<int:pk>/', CastingLineView.as_view(), name='casting_line_delete'),
    path('import-excel/', CastingLineExcelView.as_view(), name='casting_line_import_excel'),
    path('export-excel/', CastingLineExcelView.as_view(), name='casting_line_export_excel'),
    path('export-pdf/', CastingLinePDFView.as_view(), name='casting_line_export_pdf'),
]
