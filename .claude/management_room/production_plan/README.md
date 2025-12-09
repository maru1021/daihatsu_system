# 生産計画ドキュメント

## 構造

```
production_plan/
├── common/           # 共通
│   ├── stock_management.md  # 在庫（良品率、前月末）
│   └── performance.md       # 最適化
├── casting/          # 鋳造（ヘッド・ブロック・カバー）
│   ├── mold_management.md   # 金型（サイクル、UsableMold）
│   ├── algorithm.md         # アルゴリズム
│   └── frontend.md          # JS（引継ぎ）
├── machining/        # 加工
│   ├── overview.md          # 概要・モデル
│   ├── backend.md           # Python
│   └── frontend.md          # JS
├── assembly/         # 組付
│   └── overview.md          # 概要・タクト管理
└── cvt/              # CVT（無段変速機）
    ├── overview.md          # 概要・モデル・画面構成
    ├── backend.md           # Python（ビュー・保存処理）
    └── frontend.md          # JavaScript（金型管理なし）
```

## 使い方

1. [../../quick_reference.md](../../quick_reference.md)
2. [common/](common/)
3. 各ライン:
   - [casting/](casting/) - 鋳造（ヘッド・ブロック・カバー）
   - [machining/](machining/) - 加工
   - [assembly/](assembly/) - 組付
   - [cvt/](cvt/) - CVT（無段変速機）

## 最適化

- 重複削除、簡潔化、ファイル統合
