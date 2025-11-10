from django.urls import path
from management_room.views.production_management.akashi_order_list import AkashiOderListView, AkashiOrderPDFImportView

urlpatterns = [
    path('', AkashiOderListView.as_view(), name='akashi_order_list'),
    path('<int:pk>/', AkashiOderListView.as_view(), name='akashi_order_list_pk'),
    path('edit/<int:pk>/', AkashiOderListView.as_view(), name='akashi_order_list_edit'),
    path('delete/<int:pk>/', AkashiOderListView.as_view(), name='akashi_order_list_delete'),
    path('import-pdf/', AkashiOrderPDFImportView.as_view(), name='akashi_order_list_import_pdf'),
]
