from django.urls import path
from management_room.views.master.assembly_item_machining_item_map import AssemblyItemMachiningItemMapView

urlpatterns = [
    path('', AssemblyItemMachiningItemMapView.as_view(), name='assembly_item_machining_item_map'),
    path('<int:pk>/', AssemblyItemMachiningItemMapView.as_view(), name='assembly_item_machining_item_map_pk'),
    path('edit/<int:pk>/', AssemblyItemMachiningItemMapView.as_view(), name='assembly_item_machining_item_map_edit'),
    path('delete/<int:pk>/', AssemblyItemMachiningItemMapView.as_view(), name='assembly_item_machining_item_map_delete'),
]
