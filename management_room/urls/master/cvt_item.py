from django.urls import path
from management_room.views.master.cvt_item import CVTItemMasterView

urlpatterns = [
    path('', CVTItemMasterView.as_view(), name='cvt_item_master'),
    path('<int:pk>/', CVTItemMasterView.as_view(), name='cvt_item_master_pk'),
    path('edit/<int:pk>/', CVTItemMasterView.as_view(), name='cvt_item_edit'),
    path('delete/<int:pk>/', CVTItemMasterView.as_view(), name='cvt_item_delete'),
]
