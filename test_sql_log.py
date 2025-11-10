"""
SQLログのテスト用スクリプト
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'daihatsu.settings')
django.setup()

from management_room.models import Department
import logging

# ロガーを取得
logger = logging.getLogger('django.db.backends')
print(f"Logger level: {logger.level}")
print(f"Logger handlers: {logger.handlers}")
print(f"Logger filters: {[h.filters for h in logger.handlers]}")

# テスト用のDepartment作成
print("\n=== Creating test department ===")
dept = Department.objects.create(
    name="テスト部署",
    code="TEST001",
    active=True
)
print(f"Created department: {dept.name}")

# 更新
print("\n=== Updating test department ===")
dept.name = "更新済みテスト部署"
dept.save()
print(f"Updated department: {dept.name}")

# 削除
print("\n=== Deleting test department ===")
dept.delete()
print("Deleted department")

print("\n=== Check log/sql.log file ===")
