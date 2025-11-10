from django.http import JsonResponse
from django.views import View
from manufacturing.models import MachiningToolNo
from daihatsu.except_output import except_output

class MachiningToolNosByMachineView(View):
    def get(self, request, machine_id):
        try:
            tool_nos_data = list(MachiningToolNo.objects.filter(
                machine_id=machine_id,
                active=True
            ).order_by('name').values('id', 'name'))

            return JsonResponse({
                'status': 'success',
                'data': tool_nos_data
            })

        except Exception as e:
            except_output('ToolNosByMachineView', e)
            return JsonResponse({
                'status': 'error',
                'message': str(e)
            }, status=400)
