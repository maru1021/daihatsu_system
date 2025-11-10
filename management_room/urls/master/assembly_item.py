from django.urls import path
from management_room.views.master.assembly_item import AssemblyItemMasterView

urlpatterns = [
    path('', AssemblyItemMasterView.as_view(), name='assembly_item_master'),
    path('<int:pk>/', AssemblyItemMasterView.as_view(), name='assembly_item_master_pk'),
    path('edit/<int:pk>/', AssemblyItemMasterView.as_view(), name='assembly_edit'),
    path('delete/<int:pk>/', AssemblyItemMasterView.as_view(), name='assembly_delete'),
]
