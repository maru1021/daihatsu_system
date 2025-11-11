from django.urls import path
from management_room.views.master.machining_item_casting_item_map import MachiningItemCastingItemMapView

urlpatterns = [
    path('', MachiningItemCastingItemMapView.as_view(), name='machining_item_casting_item_map'),
    path('<int:pk>/', MachiningItemCastingItemMapView.as_view(), name='machining_item_casting_item_map_pk'),
    path('edit/<int:pk>/', MachiningItemCastingItemMapView.as_view(), name='machining_item_casting_item_map_edit'),
    path('delete/<int:pk>/', MachiningItemCastingItemMapView.as_view(), name='machining_item_casting_item_map_delete'),
]
