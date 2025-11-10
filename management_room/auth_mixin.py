from daihatsu.auth_mixin import AuthMixin

class ManagementRoomPermissionMixin(AuthMixin):
    """管理室の権限制御"""
    user_groups = ['management_room_user']
    admin_groups = ['management_room_admin']
