from django.apps import AppConfig


class ActualProductionConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'actual_production'
