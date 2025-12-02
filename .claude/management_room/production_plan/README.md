# 生産計画ドキュメント

## 構造

```
production_plan/
├── common/           # 共通
│   ├── stock_management.md  # 在庫（良品率、前月末）
│   └── performance.md       # 最適化
├── casting/          # 鋳造
│   ├── mold_management.md   # 金型（サイクル、UsableMold）
│   ├── algorithm.md         # アルゴリズム
│   └── frontend.md          # JS（引継ぎ）
└── machining/        # 加工
    ├── overview.md          # 概要・モデル
    ├── backend.md           # Python
    └── frontend.md          # JS
```

## 使い方

1. [../../quick_reference.md](../../quick_reference.md)
2. [common/](common/)
3. [casting/](casting/) or [machining/](machining/)

## 最適化

- 重複削除、簡潔化、ファイル統合
