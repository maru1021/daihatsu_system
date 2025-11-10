#!/bin/bash

# データベース復元スクリプト

echo "=== データベース復元開始 ==="

# 引数チェック
if [ $# -eq 0 ]; then
    echo "使用方法: $0 <バックアップファイル>"
    echo "例: $0 ./backup/backup_20250101_120000.sql"
    exit 1
fi

BACKUP_FILE=$1

# ファイルの存在確認
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ バックアップファイルが見つかりません: $BACKUP_FILE"
    exit 1
fi

echo "復元ファイル: $BACKUP_FILE"

# 確認メッセージ
read -p "データベースを復元しますか？既存のデータは上書きされます。 (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "復元をキャンセルしました"
    exit 0
fi

# PostgreSQLコンテナにデータベースを復元
docker-compose exec -T db psql -U user -d db < $BACKUP_FILE

if [ $? -eq 0 ]; then
    echo "✅ 復元が正常に完了しました"
else
    echo "❌ 復元に失敗しました"
    exit 1
fi

echo "=== 復元完了 ==="
