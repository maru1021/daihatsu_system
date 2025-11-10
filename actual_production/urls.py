from django.urls import path
from actual_production.views.master.actual_production_item import ActualProductionItemMasterView
from actual_production.views.master.attendance_select import AttendanceSelectMasterView
from actual_production.views.master.attendance_production_mapping import AttendanceProductionMappingMasterView
from actual_production.views.attendance_input import AttendanceInputView, AttendanceInputSubmitView
from actual_production.views.attendance_display import AttendanceDisplayView
from actual_production.views.company_input import CompanyInputView
from actual_production.views.production_transfer import ProductionTransferView

app_name = 'actual_production'

urlpatterns = [
    path('actual-production-item-master/', ActualProductionItemMasterView.as_view(), name='actual_production_item_master'),
    path('actual-production-item-master/<int:pk>/', ActualProductionItemMasterView.as_view(), name='actual_production_item_master_pk'),
    path('actual-production-item-master/edit/<int:pk>/', ActualProductionItemMasterView.as_view(), name='actual_production_item_edit'),
    path('actual-production-item-master/delete/<int:pk>/', ActualProductionItemMasterView.as_view(), name='actual_production_item_delete'),
    path('attendance-select-master/', AttendanceSelectMasterView.as_view(), name='attendance_select_master'),
    path('attendance-select-master/<int:pk>/', AttendanceSelectMasterView.as_view(), name='attendance_select_master_pk'),
    path('attendance-select-master/edit/<int:pk>/', AttendanceSelectMasterView.as_view(), name='attendance_select_edit'),
    path('attendance-select-master/delete/<int:pk>/', AttendanceSelectMasterView.as_view(), name='attendance_select_delete'),
    path('attendance-production-mapping-master/', AttendanceProductionMappingMasterView.as_view(), name='attendance_production_mapping_master'),
    path('attendance-production-mapping-master/<int:pk>/', AttendanceProductionMappingMasterView.as_view(), name='attendance_production_mapping_master_pk'),
    path('attendance-production-mapping-master/edit/<int:pk>/', AttendanceProductionMappingMasterView.as_view(), name='attendance_production_mapping_edit'),
    path('attendance-production-mapping-master/delete/<int:pk>/', AttendanceProductionMappingMasterView.as_view(), name='attendance_production_mapping_delete'),
    path('attendance-input/', AttendanceInputView.as_view(), name='attendance_input'),
    path('attendance-input/submit/', AttendanceInputSubmitView.as_view(), name='attendance_input_submit'),
    path('attendance-input/get-employee/', AttendanceInputView.as_view(), name='get_employee'),
    path('attendance-display/', AttendanceDisplayView.as_view(), name='attendance_display'),
    path('attendance-display/<int:pk>/', AttendanceDisplayView.as_view(), name='attendance_display_edit'),
    path('attendance-display/<int:pk>/delete/', AttendanceDisplayView.as_view(), name='attendance_display_delete'),
    path('attendance-display/bulk-update/', AttendanceDisplayView.as_view(), name='attendance_display_bulk_update'),
    path('company-input/', CompanyInputView.as_view(), name='company_input'),
    path('company-input/data/', CompanyInputView.as_view(), name='company_input_data'),
    path('production-transfer/', ProductionTransferView.as_view(), name='production_transfer'),
    path('production-transfer/data/', ProductionTransferView.as_view(), name='production_transfer_data'),
    path('production-transfer/items/', ProductionTransferView.as_view(), name='production_transfer_items'),
    path('production-transfer/save/', ProductionTransferView.as_view(), name='production_transfer_save'),
]