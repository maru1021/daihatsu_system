# クイックリファレンス

## JS頻出

```javascript
// タクト取得: 月別計画優先
const tact = itemData.tact || 0;

// 在庫: 小数累積→表示時整数化
calculatedStock += production * yieldRate - shipment;
input.value = Math.floor(calculatedStock);

// 定時・休出: チェックセル判定優先→残業入力確認は後
if (shift === 'day' && (isRegularHours || isHolidayWork)) {
    if (additionalProduction > 0) return false;
}

// 鋳造: 中子=24の倍数
const coreCount = Math.round(productionValue / 24) * 24;

// 鋳造: ライン別定時時間
if (isHeadLine) {
    REGULAR_TIME_DAY = 490;   // ヘッド: 日490分
    REGULAR_TIME_NIGHT = 485; // ヘッド: 夜485分
} else {
    REGULAR_TIME_DAY = 455;   // ブロック・カバー: 日455分
    REGULAR_TIME_NIGHT = 450; // ブロック・カバー: 夜450分
}

// 鋳造: 金型管理（ヘッドのみ）
if (!isHeadLine) return; // ブロック・カバーはスキップ

// コンロッド: 出庫数から比率→残業時間で生産数算出
const totalProducibleQuantity = Math.ceil((regularTime + overtime - stopTime) / tact * occupancyRate);
const productionQty = Math.round(totalProducibleQuantity * (shipmentValue / totalShipment));

// 鋳造: 動的な設備数対応
const machineCount = machineRows.length / 8; // 8セクション（日勤・夜勤・型替×2・残業×2・停止×2）
```

## Python頻出

```python
# タクト取得: 月別計画優先→ライン設定
def get_line_tact(plans, line_name="#1"):
    line_plans = plans.filter(line__name=line_name)
    if line_plans.exists() and line_plans[0]['tact']:
        return line_plans[0]['tact']
    return AssemblyLine.objects.get(name=line_name).tact

# 前月末在庫
.order_by('-id').first()

# 出庫数: 上位工程から計算（DBに保存しない）
# 鋳造: 加工生産数の合計
# 加工: 組付け生産数の合計（複数ラインは残業均等化で振り分け）
# コンロッド: 組付け生産数×3（外注分を考慮）
if line_name == 'コンロッド' and allocated_qty is not None:
    allocated_qty = allocated_qty * 3

# カバーライン自動計画: 緊急度評価
stock_after_delivery = current_stock - delivery_this_shift
if stock_after_delivery < 0:
    shifts_until_stockout = 0  # 緊急度最高

# カバーライン: 継続生産可能性（#650t#1, #650t#2のみ）
can_continue = any(
    machine_current_item.get(m.id) == item_name
    for m in machines
    if m.name in ['650t#1', '650t#2']
)

# カバーライン: ソート（緊急度 → 在庫 → 継続生産）
item_urgency.sort(key=lambda x: (
    x['shifts_until_stockout'],
    x['stock_after_delivery'],
    0 if x['can_continue'] else 1
))

# カバーライン: 稼働率正規化（93% stored as 93）
occupancy_rate = line.occupancy_rate / 100.0 if line.occupancy_rate > 1.0 else line.occupancy_rate

# CVT自動計画: 在庫過剰判定（900台以上はスキップ）
is_overstocked = item_info['current_stock'] >= CHANGEOVER_READY_STOCK  # 900台

# CVT自動計画: 品番選択優先順位（フェーズ2）
if item_info['shifts_until_stockout'] <= URGENCY_THRESHOLD:  # 3直以下
    should_produce = True  # 緊急度が高い → 必ず生産
elif is_continuation and not is_overstocked:
    should_produce = True  # 継続生産可能 かつ 在庫900台未満 → 生産
elif not is_overstocked:
    should_produce = True  # 在庫900台未満 → 生産
else:
    should_produce = False  # 在庫過剰 → スキップ

# CVT自動計画: 動的な在庫更新（同じ品番を複数設備に割り当てる場合）
# 設備に品番を割り当てた後、すぐに緊急度情報を更新
temp_stock = inventory.get(item_name, 0) + good_prod
item_urgency[i]['current_stock'] = temp_stock
item_urgency[i]['shifts_until_stockout'] = calculate_shifts_until_stockout(...)

# CVT自動計画: 設備選択（継続生産 → グループ内継続 → 最速タクト）
# 1. 同じ設備で継続生産可能か
if machine_current_item.get(machine.id) == item_name:
    return machine, True
# 2. グループ内（650t#1と650t#2）で継続可能か
if machine.name in GROUP_A and prev_machine_name in GROUP_A:
    return machine, True
# 3. 最速タクトの設備を選択
best_machine = min(available_machines, key=lambda m: item_data[f"{item_name}_{m.id}"]['tact'])

# CVT自動計画: 月末予測在庫を考慮した残業時間の最適化
target_stock = optimal_inventory.get(item_name, 600)  # 品番ごとの適正在庫
predicted_end_stock = stock_after_production - future_deliveries  # 月末予測在庫
deviation = abs(predicted_end_stock - target_stock)  # 適正在庫との乖離
# 乖離が最小となる残業時間を選択（過剰生産を防止）
```

## エラー対処

| エラー | 解決 |
|--------|------|
| 在庫-1 | 小数累積 |
| 全品番表示 | line_data.item_names |
| 前月末不正 | order_by('-id') |
| 加工月計(直)不一致 | 複数ライン時、親テーブル内で夜勤行検索（`table.querySelector()`） |
| コンロッド初期値 | [conrod_special_handling.md](management_room/production_plan/machining/conrod_special_handling.md) |
| カバー在庫マイナス | 生産→出荷の順序（出荷→生産だとマイナスになる） |
| カバー#1空白 | 動的設備数計算（machineCount = machineRows.length / 8） |
| カバー型替え多い | 継続生産優先ソート（can_continue）、#650t#1/#650t#2のみ |
| カバーCCH未割当 | 出荷後在庫を優先（stock_after_delivery）、継続生産は第3キー |
| CVT在庫過剰品番を生産 | `is_overstocked`チェック（900台以上はスキップ） |
| CVT緊急品番が未割当 | 同じ品番を複数設備に割り当て可能に変更（`while`ループで繰り返し選択） |
| CVT品番が「-」の設備 | 在庫過剰品番をスキップして設備が空く（正常動作） |
