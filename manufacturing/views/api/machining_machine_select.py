from django.http import JsonResponse
from django.views import View
from manufacturing.models import MachiningMachine
from daihatsu.except_output import except_output

class MachiningMachinesByLineView(View):
    def get(self, request, line_id):
        try:
            machines_data = list(MachiningMachine.objects.filter(
                line_id=line_id,
                active=True
            ).order_by('name').values('id', 'name'))

            return JsonResponse({
                'status': 'success',
                'data': machines_data
            })

        except Exception as e:
            except_output('MachinesByLineView', e)
            return JsonResponse({
                'status': 'error',
                'message': str(e)
            }, status=400)
