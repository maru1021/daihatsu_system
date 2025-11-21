from django.urls import path
from management_room.views.master.casting_item_prohibited_pattern import CastingItemProhibitedPatternView


urlpatterns = [
    path('', CastingItemProhibitedPatternView.as_view(), name='casting_item_prohibited_pattern'),
    path('edit/<int:pk>/', CastingItemProhibitedPatternView.as_view(), name='casting_item_prohibited_pattern_edit'),
    path('delete/<int:pk>/', CastingItemProhibitedPatternView.as_view(), name='casting_item_prohibited_pattern_delete'),
]
