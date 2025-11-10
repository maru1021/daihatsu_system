from daihatsu.auth_mixin import AuthMixin


class ManufacturingPermissionMixin(AuthMixin):
    """製造部門の権限制御"""
    user_groups = ['manufacturing_user']
    admin_groups = ['manufacturing_admin']
