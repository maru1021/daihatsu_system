from django import template

register = template.Library()

@register.filter
def get_item(dictionary, key):
    """辞書から指定したキーの値を取得するフィルター"""
    if dictionary and isinstance(dictionary, dict):
        return dictionary.get(key, {})
    return {}
