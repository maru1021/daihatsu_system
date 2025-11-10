from django.urls import path, include

app_name = 'management_room'

urlpatterns = [
    path('department-master/', include('management_room.urls.master.department')),
    path('employee-master/', include('management_room.urls.master.employee')),
    path('casting-item-master/', include('management_room.urls.master.casting_item')),
    path('assembly-item-master/', include('management_room.urls.master.assembly_item')),
    path('production-plan/', include('management_room.urls.production_plan')),
]
