from django.urls import path
from management_room.views.production_plan.assembly_production_plan import AssemblyProductionPlanView
from management_room.views.production_plan.machining_production_plan import MachiningProductionPlanView
from management_room.views.production_plan.casting_production_plan import CastingProductionPlanView
from management_room.views.production_plan.auto_casting_production_plan import AutoCastingProductionPlanView
from management_room.views.production_plan.production_volume_input import ProductionVolumeInputView
# from management_room.views.production_plan.machining_shipment_adjustment import MachiningShipmentAdjustmentView
from management_room.views.production_plan.excel_export import ProductionPlanExcelExportView
from management_room.views.production_plan.cvt_volume_input import CVTVolumeInputView

urlpatterns = [
    path('production-volume-input/', ProductionVolumeInputView.as_view(), name='production_volume_input'),
    path('assembly-production-plan/', AssemblyProductionPlanView.as_view(), name='assembly_production_plan'),
    path('machining-production-plan/', MachiningProductionPlanView.as_view(), name='machining_production_plan'),
    path('casting-production-plan/', CastingProductionPlanView.as_view(), name='casting_production_plan'),
    path('casting-production-plan/auto/', AutoCastingProductionPlanView.as_view(), name='auto_casting_production_plan'),
    # path('machining-shipment-adjustment/', MachiningShipmentAdjustmentView.as_view(), name='machining_shipment_adjustment'),
    path('excel-export/', ProductionPlanExcelExportView.as_view(), name='production_plan_excel_export'),
    path('cvt-volume-input/', CVTVolumeInputView.as_view(), name='cvt_volume_input'),
]
