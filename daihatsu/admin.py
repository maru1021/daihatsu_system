from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import Resource, IPBlock, CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    """カスタムユーザーのAdmin設定"""

    # リスト表示項目
    list_display = ('username', 'email', 'first_name', 'last_name', 'is_staff', 'miss_count', 'locked_until', 'is_active')

    # フィルター
    list_filter = ('is_staff', 'is_superuser', 'is_active', 'date_joined')

    # 検索フィールド
    search_fields = ('username', 'first_name', 'last_name', 'email')

    # 詳細ページのフィールド設定
    fieldsets = UserAdmin.fieldsets + (
        ('セキュリティ情報', {
            'fields': ('miss_count', 'locked_until'),
        }),
    )

    # 新規作成時のフィールド設定
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('セキュリティ情報', {
            'fields': ('miss_count', 'locked_until'),
        }),
    )

    # 読み取り専用フィールド（通常は変更しない）
    readonly_fields = ('date_joined', 'last_login')


admin.site.register(Resource)
admin.site.register(IPBlock)
