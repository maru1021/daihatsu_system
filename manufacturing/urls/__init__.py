from django.urls import path, include

from manufacturing.views.api.machining_tool_no_select import MachiningToolNosByMachineView
from manufacturing.views.api.machining_machine_select import MachiningMachinesByLineView

app_name = 'manufacturing'

urlpatterns = [
    # マスター管理
    path('assembly-line-master/', include('manufacturing.urls.master.assembly_line')),
    path('machining-line-master/', include('manufacturing.urls.master.machining_line')),
    path('casting-line-master/', include('manufacturing.urls.master.casting_line')),
    path('machining-machine-master/', include('manufacturing.urls.master.machining_machine')),
    path('casting-machine-master/', include('manufacturing.urls.master.casting_machine')),
    path('machining-tool-no-master/', include('manufacturing.urls.master.machining_tool_no')),

    # API
    path('api/machining-machines-by-line/<int:line_id>/', MachiningMachinesByLineView.as_view(), name='machining_machines_by_line'),
    path('api/machining-tool-nos-by-machine/<int:machine_id>/', MachiningToolNosByMachineView.as_view(), name='machining_tool_nos_by_machine'),
]
