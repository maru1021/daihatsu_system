from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponseNotFound
from daihatsu.login import CustomLoginView, CustomLogoutView
from daihatsu.views.resource_view import ResourceView, ResourceDataView, ResourceHourlyDataView
from daihatsu.views.ai_query_view import AIQueryView
from administrator.views import AdminRuleView

app_name = 'administrator'

urlpatterns = [
    path('rule', AdminRuleView.as_view(), name='rule'),
]
