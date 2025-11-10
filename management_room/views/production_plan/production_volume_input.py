from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.shortcuts import render
from management_room.models import AssemblyItem

class ProductionVolumeInputView(ManagementRoomPermissionMixin, View):
    template_file = 'production_plan/production_volume_input.html'

    def get(self, request, *args, **kwargs):
        engin_items = AssemblyItem.objects.filter(active=True).only('id', 'name')
        context = {
            'engine_items': engin_items,
        }
        return render(request, self.template_file, context)
