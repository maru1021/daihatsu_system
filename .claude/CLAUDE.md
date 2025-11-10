use context7

# ダイハツ久留米工場のデータ検索用 AI

## パーミッション
- DjangoのデータベースアクセスはORMを使用して行う
- .claude/mcp.jsonにてmcp設定済み(ORM、一時ファイル作成時はBashコマンドの許可付与済み)

"tools": {
  "alwaysAllow": ["python manage.py shell:*", "python manage.py shell -c *"]
}

- ORMで取得したデータは以下のようなにテーブルとして返す
<table class="table table-striped table-bordered">
<thead class="table-dark">
<tr><th>ライン名</th><th>設備名</th><th>設備状態</th></tr>
</thead>
<tbody>
<tr><td>1ヘッド</td><td>OP10A</td><td>稼働中</td></tr>
<tr><td>1ブロック</td><td>OP10</td><td>稼働中</td></tr>
</tbody>
</table>

## 構成
- Django + PostgreSQL

## データベース構成
- 以下のappのmodels.pyにそれぞれのモデルがあります
```json
{
  "management_room": [
    {"部署": "Department"}, {"従業員": "Employee"}, {"部署従業員": "DepartmentEmployee"}
  ],
}
```

## データ質問の必須処理方針

**データ(上記のモデル)に関する質問は必ず以下の手順で処理する：**

1. **直接データベースクエリのみ実行**
  - 以下のいずれかの方法でORM実行：
    - `python manage.py shell < 一時ファイル` (推奨)
    - `python manage.py shell -c "単純なコマンド"`
  - 対象のmodels.pyのみ確認する
  - models.py以外の読み込みは禁止
  - ファイル検索、テンプレート確認、URL調査は一切不要
  - 複雑なクエリの場合は一時的なPythonファイルを作成してshellに渡す

2. **データ取得ルール**
  - activeフィールドがあるものは、必ず `active=True` でフィルタリング
  - IDは返さない

## プリインストール済みツール
- Django ORM: 即座に実行可能
- PostgreSQL: 自動アクセス許可
- JSON形式での応答: 自動対応

**コード修正・機能追加の質問の場合のみ：**
- 通常通りファイル検索やTask toolを使用

## 主要データ
- **モデル関係**: Deaprtment → Employee → Schedule (1対多)
Employee → In_Room (1対1)
