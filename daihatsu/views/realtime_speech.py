from django.shortcuts import render
from django.contrib.auth.decorators import login_required
import logging

logger = logging.getLogger(__name__)

@login_required
def realtime_speech_view(request):
    """リアルタイム音声文字起こしページを表示"""
    return render(request, 'realtime_speech/full_page.html')
