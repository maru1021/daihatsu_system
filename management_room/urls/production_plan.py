from django.urls import path
from management_room.views.production_plan.casting_production_plan import CastingProductionPlanView, AutoProductionPlanView
from management_room.views.production_plan.production_volume_input import ProductionVolumeInputView

urlpatterns = [
    path('casting-production-plan/', CastingProductionPlanView.as_view(), name='casting_production_plan'),
    path('casting-production-plan/auto/', AutoProductionPlanView.as_view(), name='auto_production_plan'),
    path('production-volume-input/', ProductionVolumeInputView.as_view(), name='production_volume_input'),
]
