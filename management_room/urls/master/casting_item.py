from django.urls import path
from management_room.views.master.casting_item import CastingItemMasterView

urlpatterns = [
    path('', CastingItemMasterView.as_view(), name='casting_item_master'),
    path('<int:pk>/', CastingItemMasterView.as_view(), name='casting_item_master_pk'),
    path('edit/<int:pk>/', CastingItemMasterView.as_view(), name='casting_item_edit'),
    path('delete/<int:pk>/', CastingItemMasterView.as_view(), name='casting_item_delete'),
]
