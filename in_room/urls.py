from django.urls import path
from in_room.views import InRoomInputView, InRoomStatusView, RecordEntryView

app_name = 'in_room'

def debug_view(request):
    from django.http import JsonResponse
    return JsonResponse({'debug': 'success'})

urlpatterns = [
    path('input/', InRoomInputView.as_view(), name='in_room_input'),
    path('status/', InRoomStatusView.as_view(), name='in_room_status'),
    path('record-entry/', RecordEntryView.as_view(), name='record_entry'),
]
