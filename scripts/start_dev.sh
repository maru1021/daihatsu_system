#!/bin/bash

# 開発環境用起動スクリプト

echo "=== 開発環境起動スクリプト ==="

echo "マイグレーション開始..."
python manage.py migrate

echo "開発サーバー起動..."
python manage.py runserver 0.0.0.0:8000
