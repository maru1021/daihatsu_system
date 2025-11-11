from django.urls import path, include

app_name = 'management_room'

urlpatterns = [
    # マスター管理
    path('department-master/', include('management_room.urls.master.department')),
    path('employee-master/', include('management_room.urls.master.employee')),
    path('assembly-item-master/', include('management_room.urls.master.assembly_item')),
    path('machining-item-master/', include('management_room.urls.master.machining_item')),
    path('casting-item-master/', include('management_room.urls.master.casting_item')),

    path('production-plan/', include('management_room.urls.production_plan')),
    path('akashi-order-list/', include('management_room.urls.master.akashi_order_list')),
    path('akashi-order-aggregation/', include('management_room.urls.master.akashi_order_aggregation')),
]
