#!/bin/bash

# 本番環境用起動スクリプト

echo "=== 本番環境起動スクリプト ==="

echo "マイグレーション開始..."
python manage.py migrate

echo "静的ファイル圧縮..."
python manage.py compress --force

echo "サーバー起動..."
waitress-serve --host=0.0.0.0 --port=8000 --threads=16 --max-request-body-size=10485760 --connection-limit=1000 --cleanup-interval=30 --ident=daihatsu daihatsu.wsgi:application
