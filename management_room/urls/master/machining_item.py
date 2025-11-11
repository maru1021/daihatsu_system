from django.urls import path
from management_room.views.master.machining_item import MachiningItemMasterView

urlpatterns = [
    path('', MachiningItemMasterView.as_view(), name='machining_item_master'),
    path('<int:pk>/', MachiningItemMasterView.as_view(), name='machining_item_master_pk'),
    path('edit/<int:pk>/', MachiningItemMasterView.as_view(), name='machining_item_edit'),
    path('delete/<int:pk>/', MachiningItemMasterView.as_view(), name='machining_item_delete'),
]
