use context7

# システム仕様

## ドキュメント

- [quick_reference.md](quick_reference.md): 頻出パターン

### 生産計画
- **共通**: [management_room/production_plan/common/](management_room/production_plan/common/)
  - [stock_management.md](management_room/production_plan/common/stock_management.md): 在庫管理
  - [performance.md](management_room/production_plan/common/performance.md): 最適化

- **鋳造**: [management_room/production_plan/casting/](management_room/production_plan/casting/)
  - [line_specific_features.md](management_room/production_plan/casting/line_specific_features.md): ライン別機能（ヘッド・ブロック・カバー）
  - [mold_management.md](management_room/production_plan/casting/mold_management.md): 金型管理（ヘッドのみ）
  - [algorithm.md](management_room/production_plan/casting/algorithm.md): アルゴリズム（ヘッドのみ）
  - [cover_algorithm.md](management_room/production_plan/casting/cover_algorithm.md): カバーラインアルゴリズム
  - [frontend.md](management_room/production_plan/casting/frontend.md): JS

- **加工**: [management_room/production_plan/machining/](management_room/production_plan/machining/)
  - [overview.md](management_room/production_plan/machining/overview.md): 概要・モデル
  - [backend.md](management_room/production_plan/machining/backend.md): Python
  - [frontend.md](management_room/production_plan/machining/frontend.md): JS
  - [conrod_special_handling.md](management_room/production_plan/machining/conrod_special_handling.md): コンロッド特別処理

- **組付**: [management_room/production_plan/assembly/](management_room/production_plan/assembly/)
  - [overview.md](management_room/production_plan/assembly/overview.md): 概要・タクト管理

- **CVT**: [management_room/production_plan/cvt/](management_room/production_plan/cvt/)
  - [overview.md](management_room/production_plan/cvt/overview.md): 概要・モデル・画面構成
  - [backend.md](management_room/production_plan/cvt/backend.md): Python（ビュー・保存処理）
  - [frontend.md](management_room/production_plan/cvt/frontend.md): JavaScript（金型管理なし）

## 規約

- Python: PEP 8、`snake_case`、`PascalCase`クラス
- JavaScript: ES6+、`camelCase`、`UPPER_SNAKE_CASE`定数
- DB: 単数形、`snake_case`、`db_index=True`
