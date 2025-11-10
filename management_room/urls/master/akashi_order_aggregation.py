from django.urls import path
from management_room.views.production_management.akashi_order_aggregation import AkashiOderAggregationView

urlpatterns = [
    path('akashi-order-aggregation/', AkashiOderAggregationView.as_view(), name='akashi_order_aggregation'),
    path('akashi-order-aggregation/<str:search_date>/', AkashiOderAggregationView.as_view()),
]
