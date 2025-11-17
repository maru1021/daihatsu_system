from django.urls import path
from management_room.views.master.casting_item_machine_map import CastingItemMachineMapView

urlpatterns = [
    path('', CastingItemMachineMapView.as_view(), name='casting_item_machine_map'),
    path('<int:pk>/', CastingItemMachineMapView.as_view(), name='casting_item_machine_map_pk'),
    path('edit/<int:pk>/', CastingItemMachineMapView.as_view(), name='casting_item_machine_map_edit'),
    path('delete/<int:pk>/', CastingItemMachineMapView.as_view(), name='casting_item_machine_map_delete'),
]
