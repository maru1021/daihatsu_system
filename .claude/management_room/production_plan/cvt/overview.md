# CVT生産計画 概要

## 目的

CVT（Continuously Variable Transmission：無段変速機）部品の生産計画を管理するシステム。

## 主な特徴

### 1. 鋳造との違い

| 項目 | 鋳造（ヘッド/ブロック/カバー） | CVT |
|------|------------------------------|-----|
| **定時時間（日勤）** | 490/455分 | 455分 |
| **定時時間（夜勤）** | 485/450分 | 450分 |
| **金型使用回数管理** | ヘッドのみ有効 | **なし** |
| **金型交換時間入力** | ヘッド・カバーで有効 | **あり（手動入力）** |
| **金型引き継ぎ矢印** | ヘッドのみ | **なし** |
| **再利用可能金型リスト** | ヘッドのみ | **なし** |
| **6直連続チェック** | ヘッドのみ | **なし** |

### 2. 金型管理の違い

- **鋳造（ヘッドライン）**: 金型使用回数を自動カウント（6直で交換）、矢印表示、再利用金型管理
- **鋳造（ブロックライン）**: 金型管理なし（6直制約なし）
- **CVT**: **ブロックラインと同じ**（金型カウント管理なし、金型交換時間のみ手動入力）

### 3. データモデル

#### DailyMachineCVTProductionPlan
CVT機ごとの生産計画データ

```python
class DailyMachineCVTProductionPlan(models.Model):
    line = models.ForeignKey(CVTLine)           # CVTライン
    machine = models.ForeignKey(CVTMachine)     # CVT機（#1, #2, #3, #4）
    date = models.DateField()                   # 日付
    shift = models.CharField()                  # シフト（'day' / 'night'）
    production_item = models.ForeignKey(CVTItem) # 生産品番

    # 時間管理
    stop_time = models.IntegerField()           # 計画停止時間（分）
    overtime = models.IntegerField()            # 残業時間（分）
    mold_change = models.IntegerField()         # 金型交換時間（分）※手動入力

    # 生産実績（フロントエンドで計算）
    production_count = models.IntegerField()    # 生産台数

    # 稼働率
    occupancy_rate = models.DecimalField()      # 稼働率（0.0～1.0）
    regular_working_hours = models.BooleanField() # 定時勤務フラグ
```

#### DailyCVTProductionPlan
品番ごとの在庫・調整データ

```python
class DailyCVTProductionPlan(models.Model):
    line = models.ForeignKey(CVTLine)
    production_item = models.ForeignKey(CVTItem)
    date = models.DateField()
    shift = models.CharField()

    # 在庫管理
    stock = models.IntegerField()               # 在庫数（計算結果）
    stock_adjustment = models.IntegerField()    # 在庫調整（手動入力）
```

## ファイル構成

### バックエンド（Python）
- `management_room/views/production_plan/cvt_production_plan.py` - メインビュー
- `management_room/models.py` - データモデル（DailyMachineCVTProductionPlan, DailyCVTProductionPlan）
- `manufacturing/models.py` - マスタデータ（CVTLine, CVTMachine, CVTItem）

### フロントエンド
- `management_room/templates/production_plan/cvt_production_plan.html` - テンプレート
- `static/js/cvt_production_plan.js` - JavaScript（約2,240行）
- `static/css/production_plan.css` - スタイル（共通）

## 主要な機能

### 1. 生産計画入力
- CVT機ごとに品番を選択
- 金型交換時間、残業時間、計画停止時間を入力
- 生産台数は自動計算

### 2. 在庫管理
- 前月在庫を引き継ぎ
- 在庫数を自動計算（前の直の在庫 + 生産数 + 在庫調整）
- 月末在庫と適正在庫を比較表示

### 3. 自動生成
- AIによる最適な生産計画の自動生成
- 在庫バランスを考慮した品番配置

### 4. Excel出力
- 生産計画をExcel形式でエクスポート

## 画面構成

```
┌─────────────────────────────────────────────────┐
│ CVT生産スケジュール                              │
├─────────────────────────────────────────────────┤
│ ライン: [CVT▼]  対象月: [2024-12]  [自動][保存] │
├─────────────────────────────────────────────────┤
│           12/1  12/2  12/3  ...                 │
│           (月)  (火)  (水)                      │
│ ─────────────────────────────────────────────── │
│ 生産台数                                        │
│  日勤  SHC    20    30    25                   │
│  夜勤  SHC    20    30    25                   │
│ ─────────────────────────────────────────────── │
│ 在庫数                                          │
│  日勤  SHC   100   110   115                   │
│  夜勤  SHC   100   110   115                   │
│ ─────────────────────────────────────────────── │
│ 生産計画                                        │
│  日勤  #1   [SHC▼] [F/CTC▼]                    │
│  夜勤  #1   [SHC▼] [F/CTC▼]                    │
│ ─────────────────────────────────────────────── │
│ 金型交換                                        │
│  日勤  #1    [30]   [0]                        │
│ ─────────────────────────────────────────────── │
│ 残業計画                                        │
│  日勤  #1    [60]   [30]                       │
└─────────────────────────────────────────────────┘
```

## 計算ロジック

### 生産台数計算

```javascript
// 稼働時間 = 基本時間 - 計画停止 - 金型交換 + 残業
const workingTime = baseTime - stopTime - moldChangeTime + overtime;

// 良品生産数 = (稼働時間 / タクト) × 良品率 × 稼働率
const goodCount = Math.floor((workingTime / tact) * yieldRate * occupancyRate);
```

### 在庫計算

```javascript
// 在庫数 = 前の直の在庫 + 良品生産数 + 在庫調整
inventory = previousInventory + goodProduction + stockAdjustment;
```

## 参照

- [バックエンド詳細](backend.md)
- [フロントエンド詳細](frontend.md)
- [共通機能](../common/stock_management.md)
