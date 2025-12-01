from django.urls import path
from management_room.views.master.cvt_item_machine_map import CVTItemMachineMapView

urlpatterns = [
    path('', CVTItemMachineMapView.as_view(), name='cvt_item_machine_map'),
    path('<int:pk>/', CVTItemMachineMapView.as_view(), name='cvt_item_machine_map_pk'),
    path('edit/<int:pk>/', CVTItemMachineMapView.as_view(), name='cvt_item_machine_map_edit'),
    path('delete/<int:pk>/', CVTItemMachineMapView.as_view(), name='cvt_item_machine_map_delete'),
]
