from daihatsu.auth_mixin import AuthMixin


class ActualProductionPermissionMixin(AuthMixin):
    """製造部門の権限制御"""
    user_groups = ['actual_production_user']
    admin_groups = ['actual_production_admin']
