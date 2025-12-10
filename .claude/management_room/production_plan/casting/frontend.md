# 鋳造フロントエンド

## ドキュメント構成

- **共通モジュール**: [../common/shared_modules.md](../common/shared_modules.md) - 鋳造・CVT共通のJavaScriptモジュール
- **ライン別機能**: [line_specific_features.md](line_specific_features.md) - ヘッド・ブロック・カバーの違い
- **金型管理**: [mold_management.md](mold_management.md) - 金型カウント・引き継ぎ（ヘッドのみ）
- **アルゴリズム**: [algorithm.md](algorithm.md) - ヘッドライン用アルゴリズム
- **カバーアルゴリズム**: [cover_algorithm.md](cover_algorithm.md) - カバーライン用アルゴリズム

## ファイル構成

```
static/js/management_room/production_plan/
├── casting_production_plan.js  (~3,680行)
├── cvt_production_plan.js      (~1,200行)
└── shared/
    └── casting/                # 共通モジュール（詳細は shared_modules.md 参照）
        ├── index.js            # エントリーポイント
        ├── utils.js            # ユーティリティ
        ├── cache.js            # キャッシュ構築
        ├── inventory.js        # 在庫計算
        ├── calculation.js      # 集計計算
        └── control.js          # UI制御
```

## 主要な特徴

### 1. モジュール化アーキテクチャ

共通機能を`shared/casting/`モジュールに分離:

```javascript
import {
    debounce,
    buildDOMCache,
    recalculateAllInventory,
    updateSelectColor,
    getMachineName,
    moveToNextShift,
    // ... 他の関数
} from './shared/casting/index.js';
```

**ラッパー関数で呼び出し**:
```javascript
// グローバルキャッシュを準備
function getCaches() { /* ... */ }

// ラッパー関数を定義
function buildDOMCacheWrapper(options = {}) {
    const caches = getCaches();
    const result = buildDOMCache(options, caches);
    // ローカルキャッシュに反映
    vehicleSelectCache = result.vehicleSelectCache;
}

// 使用時
buildDOMCacheWrapper({ includeMoldCount: true });  // 鋳造は金型カウントあり
```

詳細は [共通モジュール](../common/shared_modules.md) を参照。

### 2. 金型引き継ぎ（ヘッドのみ）

- 矢印: 他設備からのみ
- 品番変更: 3方向クリア（前・後・全体品番不一致）
- 前月金型: `prevMonthMoldsStatus[itemName].used = true` → `used=false`のみ表示

### 3. 中子（24の倍数）

```javascript
const coreCount = Math.round(productionValue / 24) * 24;
```

## 鋳造独自の関数（shared非対象）

以下は鋳造ライン固有の機能のため、共通モジュールに含まれません:

### 金型管理関連
- `updateMoldCountForMachineFromShift()` - 金型使用回数の更新
- `drawInheritanceArrows()` - 金型引き継ぎ矢印の描画
- `updateReusableMolds()` - 再利用可能金型の管理
- `getConsecutiveShiftCount()` - 連続使用回数の取得
- `searchOtherMachinesForCount()` - 他設備の金型カウント検索

### ライン別処理
- `calculateProduction()` - 生産台数計算（タクト・良品率がライン別）
- `applyItemChangeHighlights()` - 型替えハイライト（ライン別ロジック）

## 関連ドキュメント

- [共通モジュール](../common/shared_modules.md)
- [ライン別機能](line_specific_features.md)
- [金型管理](mold_management.md)
- [パフォーマンス最適化](../common/performance.md)
