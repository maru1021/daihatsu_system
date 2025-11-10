from django import template

register = template.Library()

@register.simple_tag
def user_groups(user):
    """ユーザーの全グループ名をセットで返す"""
    """サイドバーの表示切り替えで使用"""
    if not user.is_authenticated:
        return set()
    return set(user.groups.values_list('name', flat=True))