バージョンなど
postgresql 17.6(18.0もあるが、出たばかりでバグがある可能性があるので17.6)
https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
python 3.13.7
https://www.python.org/downloads/windows/

DEBUG=False時は
python manage.py compress
を実行忘れとエラーになる
django.logでログ確認

# 製造管理システム セットアップガイド

> **注意**: Docker 未使用時用のガイドです。Docker 使用時は `DOCKER_USAGE.md` を参考にしてください。

## Django の設定

以下の操作は `manage.py` と同じディレクトリで行う

### パッケージのインストール

#### ネットワーク接続環境
```bash
pip install -r requirements.txt
```

#### オフライン環境
1. ネットワーク接続PC でパッケージをダウンロード
```bash
pip download -r requirements.txt -d offline_packages/
```

2. オフライン環境でインストール
```bash
pip install --no-index --find-links offline_packages/ -r requirements.txt
```

パッケージ追加時は、`requirements.txt` に追記し、`offline_packages` フォルダに whl ファイルを追加してから上のコマンドを再実行

### 初回セットアップ

1. **データベースの作成**
```bash
python manage.py makemigrations
python manage.py migrate
```

2. **サーバーの起動**
```bash
# 開発環境
python manage.py runserver

# ホットリロード付き開発環境
python dev.py
```

### データベース管理

#### テーブル新規追加・変更
1. 対象の `models.py` にて追加・変更などを行う
2. マイグレーションの実行
```bash
python manage.py makemigrations
python manage.py migrate
```

#### 管理者ユーザーの作成
```bash
python manage.py createsuperuser
```

#### 管理者ページへのテーブル追加
表示したいテーブルのモデルがあるアプリの `admin.py` に追記：
```python
admin.site.register(管理者ページに追加したいテーブルのモデル)
```

## インフラ設定

### nginx の設定
nginx を使用することで `http://ip` のみでアクセス可能

1. **設定**
```bash
cd C:\nginx-1.28.0
# C:\nginx-1.28.0\conf\nginx.conf を編集
start nginx
```

nginxの停止
taskkill /F /IM nginx.exe

> **注意**: PC シャットダウン後は再度実行が必要

### waitress の起動（本番環境）
```bash
waitress-serve --host=127.0.0.1 --port=8000 --threads=8 daihatsu.wsgi:application
```

### データベース（PostgreSQL）
- **初期ユーザー名**: `postgres`

システム環境変数にC:\Program Files\PostgreSQL\17\binを追加

データベースの作成
psql -U postgres
CREATE DATABASE daihatsu_kyushu_db OWNER postgres;

権限付与
\c daihatsu_kyushu_db
GRANT ALL ON SCHEMA public TO postgres;
新しいユーザーの作成
CREATE USER hogehoge WITH PASSWORD 'hugahuga' SUPERUSER CREATEDB CREATEROLE;
ALTER DATABASE daihatsu_kyushu_db OWNER TO hogehoge;
\q

初期ユーザーの無効化
ALTER USER postgres WITH NOLOGIN;
ALTER USER postgres WITH PASSWORD NULL;
\du
\q

postgresqlの起動(管理者権限)
net start postgresql-x64-17

psql -U hogehoge daihatsu_kyushu_db

初期ユーザーを再度使用可能にする
psql -U dkc -d dkc
ALTER USER postgres WITH LOGIN;
ALTER USER postgres WITH PASSWORD '新しいパスワード';

データベースの復元
postgresqlにて新たにデータベースを作成、フルバックアップファイルを使用し、リストア後
psql -U ユーザー名 -d データベース名 -f sql_restore.log

## 本番環境の設定

### JS/CSS 圧縮（DEBUG=FALSE 時）
```bash
# キャッシュをクリアして圧縮ファイルを再生成
rmdir /s /q static\CACHE
python manage.py compress --force
```

## 負荷テスト

### Apache Bench を使用
```bash
# インストール確認
which ab

# 負荷テスト実行
ab -n リクエスト数 -c 同接数 http://127.0.0.1/
```

## AI 設定

## 音声文字起こし

### ffmpegのインストール
```bash
brew install ffmpeg
brew install portaudio

### 使用方法

#### ローカルWhisper（APIキー不要）
```bash
# 基本的な使用方法
python daihatsu/scripts/speech_to_text/local_speech_to_text.py audio.mp3

# モデルサイズを指定（高精度だが時間がかかる）
python local_speech_to_text.py --model large audio.mp3

# 英語翻訳
python local_speech_to_text.py --task translate audio.mp3

# 字幕ファイル生成
python local_speech_to_text.py --format srt audio.mp3
```

### モデルサイズ比較
- `tiny`: 39MB, 高速だが精度低め
- `base`: 74MB, バランス型（推奨）
- `small`: 244MB, 高精度
- `medium`: 769MB, より高精度
- `large`: 1550MB, 最高精度だが時間がかかる

### サーバーの80、443ポートを開ける
管理者権限powershellで
New-NetFirewallRule -DisplayName "Nginx HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow

New-NetFirewallRule -DisplayName "Nginx HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow -Profile Any -Enabled True

Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private

### 指定したIP以外からのリモートデスクトップを遮断する
管理者powershellで

許可するIPの追加
New-NetFirewallRule -DisplayName "Allow RDP from 10.69.176.176" `
      -Direction Inbound `
      -Protocol TCP `
      -LocalPort 3389 `
      -RemoteAddress 10.69.176.176 `
      -Action Allow `
      -Enabled True `
      -Profile Any `
      -Program Any `
      -EdgeTraversalPolicy Block


ユーザー削除時
Remove-NetFirewallRule -DisplayName "Allow RDP from ipアドレス"

許可されているユーザー一覧の確認
Get-NetFirewallRule | Where-Object {
    $_.DisplayName -like "Allow RDP from *"
} | ForEach-Object {
    $rule = $_
    $filter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule
    [PSCustomObject]@{
        Name           = $rule.DisplayName
        RemoteAddress = $filter.RemoteAddress
    }
}
