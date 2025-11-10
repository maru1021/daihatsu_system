from django.urls import path
from manufacturing.views.master.machining_tool_no import MachiningToolNoView, MachingToolNoExcelView

urlpatterns = [
    path('', MachiningToolNoView.as_view(), name='machining_tool_no_master'),
    path('<int:pk>/', MachiningToolNoView.as_view(), name='machining_tool_no_master_pk'),
    path('edit/<int:pk>/', MachiningToolNoView.as_view(), name='machining_tool_no_edit'),
    path('delete/<int:pk>/', MachiningToolNoView.as_view(), name='machining_tool_no_delete'),
    path('import-excel/', MachingToolNoExcelView.as_view(), name='machining_tool_no_import_excel'),
    path('export-excel/', MachingToolNoExcelView.as_view(), name='machining_tool_no_export_excel'),
]
