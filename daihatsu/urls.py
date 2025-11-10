from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponseNotFound
from daihatsu.login import CustomLoginView, CustomLogoutView
from daihatsu.views.resource_view import ResourceView, ResourceDataView, ResourceHourlyDataView
from daihatsu.views.ai_query_view import AIQueryView
from daihatsu.views.session_view import KeepSessionAliveView
from daihatsu.views.realtime_speech import realtime_speech_view
from daihatsu.views.password_change import PasswordChangeView
from daihatsu.views.port_test import PortTestView
from daihatsu.views.graph_maker_view import GraphMakerView
from daihatsu.views.schedule_import import ScheduleImport
from daihatsu.views.get_local_error import GetLocalError

urlpatterns = [
    path('', TemplateView.as_view(template_name='home.html'), name='home'),
    path('auth/login', CustomLoginView.as_view(template_name='auth/login.html'), name='login'),
    path('auth/logout', CustomLogoutView.as_view(), name='logout'),
    path('auth/password-change/', PasswordChangeView.as_view(), name='password_change'),
    path('tools/port-test/', PortTestView.as_view(), name='port_test'),
    path('tools/graph-maker/', GraphMakerView.as_view(), name='graph_maker'),
    path('administrator/', include('administrator.urls'), name='administrator'),
    path('resource/', ResourceView.as_view(), name='resource'),
    path('resource/data/real-time', ResourceDataView.as_view(), name='resource_data'),
    path('resource/data/hourly', ResourceHourlyDataView.as_view(), name='resource_hourly_data'),
    path('ai-query/', AIQueryView.as_view(), name='ai_query'),
    path('realtime-speech/', realtime_speech_view, name='realtime_speech'),
    path('keep-session-alive/', KeepSessionAliveView.as_view(), name='keep_session_alive'),
    path('admin/', admin.site.urls),
    path('management_room/', include('management_room.urls')),
    path('manufacturing/', include('manufacturing.urls')),
    path('in_room/', include('in_room.urls')),
    path('actual_production/', include('actual_production.urls')),
    # ローカルからのバッチ系統
    path('schedule_import', ScheduleImport.as_view(), name='schedule_import'),
    path('local_error', GetLocalError.as_view(), name='local_error'),

    # Chrome DevToolsリクエストを早期に404で返す
    path('.well-known/appspecific/com.chrome.devtools.json',
         lambda request: HttpResponseNotFound()),
]

# 静的ファイルの提供（開発環境と本番環境の両方で）
if settings.DEBUG:
    # 開発環境：通常の静的ファイル提供
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATICFILES_DIRS[0])
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    # 本番環境：カスタム静的ファイルビュー
    from django.views.static import serve
    from django.urls import re_path

    urlpatterns += [
        re_path(r'^static/(?P<path>.*)$', serve, {'document_root': settings.STATICFILES_DIRS[0]}),
        re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    ]
