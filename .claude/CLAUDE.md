use context7

# 鋳造生産計画の金型管理システム

## ファイル構造

### 生産計画関連ファイル
```
management_room/views/production_plan/
├── casting_production_plan.py (785行)
│   └── CastingProductionPlanView - 手動生産計画のビュー
│       ├── get() - 生産計画画面の表示
│       └── post() - 手動計画の保存
│
└── auto_casting_production_plan.py (1180行)
    └── AutoCastingProductionPlanView - 自動生産計画のビュー
        ├── post() - 自動計画生成のエントリーポイント (218行)
        └── _generate_auto_plan() - 自動計画生成のメインロジック (930行)
            ├── ネスト関数（7つ）:
            │   ├── set_mold_count_for_item_change() - 品番変更時の型数設定
            │   ├── set_mold_count_for_continue() - 継続時の型数設定
            │   ├── calculate_estimated_production() - 生産数計算
            │   ├── simulate_future_inventory_for_item() - 品番別在庫シミュレーション
            │   ├── calculate_end_of_month_inventory_all_items() - 全品番月末在庫計算
            │   ├── can_assign_item() - 1直における制約チェック
            │   ├── can_assign_item_for_6_shifts() - 6直分の制約チェック
            │   └── find_most_urgent_item() - 最優先品番の選定
            │
            └── アルゴリズムの流れ:
                1. 初期化（定数、変数、ログファイル）
                2. 前月からの引き継ぎ処理
                3. 型替えイベント駆動メインループ
                4. 残りの直の処理
                5. 型替え時間ルールの適用
                6. 結果フォーマット
```

### URL設定
```
management_room/urls/production_plan.py
├── casting-production-plan/ → CastingProductionPlanView
└── casting-production-plan/auto/ → AutoCastingProductionPlanView
```

### フロントエンド
```
static/js/casting_production_plan.js
├── 金型カウント計算
├── 金型引き継ぎ管理
├── 再利用可能金型管理
├── 自動計画適用
└── 保存処理
```

## 金型管理のルール

### 基本ルール
1. **型数の範囲**: 1→2→3→4→5→6のサイクル
2. **6直完了後**: 金型メンテナンス後、新しい金型を型数=1で開始
3. **途中で品番変更**: 使いかけの金型（型数1～5）は記録し、次に同じ品番を生産する時に引き継ぐ
4. **型数=0は存在しない**: 0は一時的な内部状態で、実際の金型としては無効

### 使用可能金型（UsableMold）の管理

#### end_of_monthフラグの意味

| フラグ | 意味 | 引き継ぎルール | 表示 |
|--------|------|---------------|------|
| `end_of_month=true` | 月末時点で設備に取り付いている金型 | 翌月に**同じ設備でのみ**引き継ぎ可能 | 再利用可能金型リストに**表示されない** |
| `end_of_month=false` | 月内で途中で外された金型 | 翌月に**どの設備でも**引き継ぎ可能 | 再利用可能金型リストに**表示される** |

#### バックエンド: 前月金型の取得

```python
# views/production_plan/casting_production_plan.py
prev_usable_molds = UsableMold.objects.filter(
    month=prev_month,
    line=line
).select_related('machine', 'item_name')

# end_of_month=true と false の両方が含まれる
for mold in prev_usable_molds:
    prev_usable_molds_data.append({
        'machine_name': mold.machine.name,
        'item_name': mold.item_name.name,
        'used_count': mold.used_count,
        'end_of_month': mold.end_of_month  # フラグを渡す
    })
```

#### フロントエンド: 保存時（`collectUsableMoldsData`）

```javascript
// 1. 月内での途中型替え（end_of_month=false）
reusableMolds.forEach(mold => {
    if (mold.dateIndex === -1) return;  // 前月データは除外

    usableMolds.push({
        machine_index: mold.machineIndex,
        item_name: mold.itemName,
        used_count: mold.count,
        end_of_month: false  // 月内で途中で外された金型
    });
});

// 2. 月末の最終直で取り付いている金型（end_of_month=true）
// 実際に稼働している最終直を見つける（土日の場合は前の稼働日）
// night直から逆順に探し、なければday直を探す
if (lastShiftDateIndex !== -1 && lastShift) {
    for (let m = 0; m < totalMachines; m++) {
        const lastSelect = selectElementCache[lastShift]?.[lastShiftDateIndex]?.[m];
        const lastMoldDisplay = moldCountDisplayCache[lastShift]?.[lastShiftDateIndex]?.[m];

        if (lastSelect && lastMoldDisplay && lastSelect.value) {
            const moldCount = parseInt(lastMoldDisplay.textContent) || 0;

            if (moldCount > 0 && moldCount < MOLD_CHANGE_THRESHOLD) {
                // reusableMoldsに既に含まれていない場合のみ追加
                if (!endOfMonthMoldSet.has(moldKey)) {
                    usableMolds.push({
                        machine_index: m,
                        item_name: itemName,
                        used_count: moldCount,
                        end_of_month: true  // 月末時点で取り付いている
                    });
                }
            }
        }
    }
}
```

#### フロントエンド: ページロード時（`updateReusableMolds`）

```javascript
// 【重要】前月の途中型替え金型（end_of_month=false）を再利用可能金型リストに追加
if (typeof prevMonthMoldsOriginal !== 'undefined' && prevMonthMoldsOriginal) {
    prevMonthMoldsOriginal.forEach((mold, index) => {
        // end_of_month=falseのもののみを追加
        if (!mold.end_of_month && !prevMonthMoldsStatus[index].used && !prevMonthMoldsStatus[index].exhausted) {
            reusableMolds.push({
                itemName: mold.item_name,
                count: mold.used_count,
                dateIndex: -1,  // 前月データを示す特殊値
                shift: 'prev_month',
                machineIndex: moldMachineIndex
            });
        }
    });
}
```

#### フロントエンド: 引き継ぎ処理（`searchOtherMachinesForCount`）

```javascript
// 前月金型から引き継ぎ可能かチェック
for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
    const mold = prevMonthMoldsOriginal[i];
    const status = prevMonthMoldsStatus[i];

    if (mold.item_name === currentItem && !status.used && !status.exhausted) {
        // 【重要】引き継ぎ可能条件の判定
        const canInherit = mold.end_of_month
            ? (moldMachineIndex === machineIndex)  // 月末取り付き金型: 同じ設備のみ
            : true;  // 途中型替え金型: どの設備でも可

        if (canInherit) {
            return {
                count: mold.used_count + 1,
                source: { dateIndex: -1, shift: 'prev_month', machineIndex: moldMachineIndex }
            };
        }
    }
}
```

## バックエンド（自動生産計画）

### 目標優先順位
1. **矢印を最小化**（6直連続生産を優先し、型替え回数を削減）
2. **全品番の残個数を均等化**（月末予測在庫の偏りを最小化）
3. **適正在庫周辺を保つ**

### アルゴリズムの流れ

#### 1. 初期化フェーズ
- 前月最終在庫、使用可能金型、品番ペア制約などを取得
- 前月から継続する設備の型数を引き継ぎ（`end_of_month=true`のみ）
- 次の型替えタイミング（`next_changeover_timing`）を計算
  - 前月から継続する場合: `MOLD_CHANGE_THRESHOLD - shift_count`（残り直数）
  - 未設定の場合: 0（最初の直から開始）

#### 2. 型替えイベント駆動メインループ

```python
while processed_shift_idx < len(all_shifts):
    # 最も早い型替えタイミングを持つ設備を特定
    next_machine_id = min(next_changeover_timing, key=lambda m: next_changeover_timing[m])

    # 型替えタイミングまでの在庫・出荷処理を実行
    for shift_idx in range(processed_shift_idx, next_timing):
        # 出荷処理
        # 生産処理（既に決定済みの計画）
        # 在庫更新

    # 型替えタイミングで品番を決定
    urgent_item = find_most_urgent_item(...)

    # 6直分の計画を一度に立てる
    for i in range(MOLD_CHANGE_THRESHOLD):
        # 計画を追加
        # 型替え時間を設定（品番変更時の最終直、6直目）

    # 次の型替えタイミングを更新
    next_changeover_timing[machine_id] = next_timing + MOLD_CHANGE_THRESHOLD
```

#### 3. 緊急度判定（`find_most_urgent_item`）

**品番選定優先順位**:
1. **6直分すべての直で禁止パターンに違反しない品番のみを候補とする**
2. 将来在庫がマイナスになる品番（最も早く在庫切れする順）
3. 在庫切れがない場合は、月末在庫が最小になる品番

**制約チェック**:
- `can_assign_item`: 1つの直における制約（同一品番上限2台、品番ペア制約）
- `can_assign_item_for_6_shifts`: 6直分すべての直で禁止パターンに違反しないかチェック

```python
def find_most_urgent_item(machine_items, current_shift_idx, machine_id, assigned_items_count, prohibited_patterns):
    for item_name in machine_items:
        # 1. 現在の直での制約チェック
        if not can_assign_item(item_name, assigned_items_count, prohibited_patterns):
            continue

        # 2. 6直分すべての直での制約チェック
        if not can_assign_item_for_6_shifts(item_name, current_shift_idx, machine_id, prohibited_patterns):
            continue

        # 在庫シミュレーション...
```

#### 4. 品番割り当て可能性チェック

##### `can_assign_item` - 1つの直における制約チェック

```python
def can_assign_item(item_name, assigned_items_count, prohibited_patterns):
    MAX_MACHINES_PER_ITEM = 2

    # 同一品番の上限チェック
    if assigned_items_count.get(item_name, 0) >= MAX_MACHINES_PER_ITEM:
        return False

    # 品番ペア制約チェック
    new_item_count = assigned_items_count.get(item_name, 0) + 1

    for other_item, other_count in assigned_items_count.items():
        pair_key = f"{item_name}_{other_item}"
        pair_limit = prohibited_patterns.get(pair_key)

        if pair_limit is not None:
            total_count = new_item_count + other_count
            # pair_limit以上は禁止（例: pair_limit=3の場合、合計3台以上は禁止）
            if total_count >= pair_limit:
                return False

    return True
```

**重要**: 禁止パターンの値は「合計台数がその値以上を禁止」する意味
- 例: VE7とVET2で`prohibited_patterns['VE7_VET2'] = 3`の場合
  - VE7=1台 + VET2=1台 = 2台合計: OK（合計2台は許可）
  - VE7=2台 + VET2=1台 = 3台合計: NG（合計3台以上は禁止）

##### `can_assign_item_for_6_shifts` - 6直分すべての直での制約チェック

```python
def can_assign_item_for_6_shifts(item_name, current_shift_idx, machine_id, prohibited_patterns):
    """6直分すべての直で禁止パターンに違反しないかチェック"""
    for i in range(min(MOLD_CHANGE_THRESHOLD, len(all_shifts) - current_shift_idx)):
        shift_idx = current_shift_idx + i
        shift_date, shift_name = all_shifts[shift_idx]

        # この直で既に割り当てられている品番をカウント
        assigned_items_count = {}
        for m in machines:
            if m.id == machine_id:
                continue  # 自分自身は除外

            plan_list = [p for p in machine_plans[m.id]
                       if p['date'] == shift_date and p['shift'] == shift_name]
            if plan_list:
                item = plan_list[0]['item_name']
                assigned_items_count[item] = assigned_items_count.get(item, 0) + 1

        # この品番を追加できるかチェック
        if not can_assign_item(item_name, assigned_items_count, prohibited_patterns):
            return False

    return True
```

#### 5. 金型カウント設定

##### 品番変更時（`set_mold_count_for_item_change`）

```python
# 現在の品番の使いかけ金型を記録（1～5の場合）
if not detached_current_mold and current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD:
    detached_molds[current_item].append(shift_count)

# 新しい品番の使いかけ金型があれば引き継ぐ
if new_item in detached_molds and len(detached_molds[new_item]) > 0:
    inherited_count = detached_molds[new_item].pop(0)
    new_mold_count = inherited_count + 1
else:
    new_mold_count = 1
```

##### 継続時（`set_mold_count_for_continue`）

```python
# 型数=0（6直完了後）の場合、使いかけ金型を引き継ぐ
if shift_count == 0 and item_name in detached_molds:
    inherited_count = detached_molds[item_name].pop(0)
    new_mold_count = inherited_count + 1
else:
    new_mold_count = shift_count + 1  # 通常は+1
```

#### 6. 型替え時間の設定

**重要**: 型替え時間は常に**前の品番の最終直**に設定する

- **6直目**: 常に`CHANGEOVER_TIME`を設定（金型メンテナンス）
- **品番変更（型替えイベント駆動）**:
  - 前の品番の最終直に型替え時間を追加設定
  - 新しい品番の1直目には型替え時間は**不要**（金型は既に取り付けられている）

```python
# 品番変更の場合、前の品番の最終直に型替え時間を設定
if current_item and current_item != urgent_item:
    prev_plans = [p for p in machine_plans[machine.id]
                if p['item_name'] == current_item]
    if prev_plans:
        prev_plans[-1]['changeover_time'] = CHANGEOVER_TIME
```

### 在庫シミュレーション（`simulate_future_inventory_for_item`）

```python
def simulate_future_inventory_for_item(item_name, from_shift_idx, temp_machine_plans):
    simulated_inv = inventory.get(item_name, 0)

    for idx in range(from_shift_idx, len(all_shifts)):
        # 出庫
        simulated_inv -= delivery

        # 生産（良品のみを在庫に加算）
        production = calculate_estimated_production(...)
        simulated_inv += math.floor(production * yield_rate)

        # マイナスになる直があればFalse
        if simulated_inv < 0:
            return False, simulated_inv, idx

    return True, simulated_inv, -1
```

### 金型記録条件
- `detached_molds`には型数1～5のみ記録（0と6は記録しない）
- 金型は全設備で共有されるため、設備IDは含めない
- 同一品番でも複数の使いかけ金型が存在する可能性があるためリスト形式
- 同じ直で同じ金型を複数回記録しない（`detached_current_mold`フラグで制御）

### 前月からの引き継ぎ

```python
# end_of_month=Trueのデータのみ引き継ぎ
if 0 < mold['used_count'] < MOLD_CHANGE_THRESHOLD:
    machine_current_item[machine_id] = item_name
    machine_shift_count[machine_id] = mold['used_count']
    # 注意: detached_moldsには記録しない（設備に取り付けられた状態で開始）

# 前月から継続する設備はメインループの前に計画を立てる
for machine in machines:
    if current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD:
        # 残り直数分の計画を立てる
        remaining_shifts = MOLD_CHANGE_THRESHOLD - shift_count
        for i in range(remaining_shifts):
            # 計画を追加
            current_mold_count = shift_count + i + 1
```

### ログ出力

デバッグ用に詳細なログを`inventory_simulation_log.txt`に出力:
- 初期状態と次の型替えタイミング
- 前月から継続する設備の計画
- 各直の出荷・生産・在庫処理
- 型替えイベント（品番決定）
- 使いかけ金型の状態

## フロントエンド（金型引き継ぎ）

### 1. 引き継ぎ情報の双方向管理

引き継ぎは双方向で管理される：
- **引き継ぎ元**: `data-mold-inheritance-target`属性（引き継ぎ先への参照）
- **引き継ぎ先**: `data-mold-inheritance`属性（引き継ぎ元への参照）
- **矢印表示**: 他設備からの引き継ぎのみ表示（同一設備継続では矢印なし）

**重要**: 同一設備継続でも、引き継ぎ先に`data-mold-inheritance`を設定する。これにより、引き継ぎ先が変更された時に引き継ぎ元を特定できる。

### 2. 同一設備での継続優先

同一設備での継続は、他設備からの引き継ぎよりも優先される。

**処理手順**:
1. 引き継ぎ元から既存のターゲットへの参照を完全に削除
2. 既存のターゲットの引き継ぎ情報をクリア
3. 現在の設備の引き継ぎ元への新しい参照を設定
4. 既存のターゲットを再計算

この順序により、既存のターゲットは引き継ぎ元を使えなくなり、他の金型を探すかcount=1になる。

### 3. 品番変更時の引き継ぎクリア

品番変更時には、引き継ぎ情報を**双方向**かつ**全体**でクリアする。

**実装**（3つの処理）:

1. **前方向クリア**（`clearInheritanceChain`）:
   - 引き継ぎ元として参照している先の連鎖を再帰的にクリア
   - 引き継ぎ元 → 引き継ぎ先 → さらに先... という連鎖をすべてクリア

2. **後方向クリア**:
   - この設備が引き継ぎ先の場合、`data-mold-inheritance`から引き継ぎ元を特定
   - 引き継ぎ元の`data-mold-inheritance-target`をクリア

3. **全体クリア**（`clearStaleInheritanceReferences`）:
   - 全設備の`data-mold-inheritance-target`をチェック
   - この設備への参照で、品番が一致しない場合は参照を削除
   - 複数の設備が同じ引き継ぎ元を参照している場合の上書き問題に対応

### 4. 矢印描画時の品番チェック

矢印を描画する際、引き継ぎ元の現在の品番と`data-mold-inheritance-target`の`itemName`が一致しているかチェック。品番が一致しない場合は矢印を描画しない。

## 注意事項とベストプラクティス

### バックエンド（自動生産計画）

- **型数は必ず1～6の範囲**（0は一時状態で、次の直で1から開始）
- **`detached_molds`には型数1～5のみ記録**（0と6は記録しない）
- **金型は全設備で共有**（`detached_molds`に設備IDは含めない）
- **同じ直で同じ金型を複数回記録しない**（`detached_current_mold`フラグで制御）
- **6直分の計画を一度に立てる**（型替えイベント駆動）
- **前月から継続する設備はメインループの前に処理**
- **型替えタイミングは残り直数で管理**（`next_changeover_timing`）
- **型替え時間の設定タイミング**:
  - 品番変更時: **前の品番の最終直**（1直目ではない）
  - 6直目: 常に（金型メンテナンス）
  - 夜勤→日勤で品番変更: 夜勤
  - 日勤→夜勤で品番変更: 日勤
- **品番選定ロジック**:
  - 6直分すべての直で禁止パターンに違反しない品番のみを候補とする
  - 将来在庫がマイナスになる品番を最優先
  - 在庫切れがない場合は月末在庫が最小の品番を選択
- **禁止パターン**: `pair_limit`以上を禁止（例: `pair_limit=3`なら3台以上は禁止）
- **生産数は不良品も含むが、在庫に加算するのは良品のみ**（yield_rateを考慮）

### フロントエンド（金型引き継ぎ）

- **引き継ぎ元には必ず`data-mold-inheritance-target`を設定**（同一設備継続でも他設備引き継ぎでも）
- **引き継ぎ先には必ず`data-mold-inheritance`を設定**（同一設備継続でも設定、矢印は他設備引き継ぎのみ）
- **品番変更時は、前方向・後方向・全体の3方向でクリアが必要**
- **同一設備での継続優先時は、`removeAttribute`→新規設定→再計算の順序を厳守**

### 使用可能金型（UsableMold）

- **最終直の特定**: 月末が土日の場合、実際に稼働している最終直（night優先、なければday）を見つける
- **重複チェック**: 同じ金型がreusableMoldsと月末取り付き金型の両方に含まれないようにする
- **引き継ぎルールの違い**: `end_of_month`フラグにより引き継ぎ可能な設備が異なる
  - `end_of_month=true`: 同じ設備のみ
  - `end_of_month=false`: どの設備でも可

## 前月金型の再利用可能リスト管理の仕組み

### 問題の背景
前月から引き継いだ金型（`end_of_month=false`）を使用後、別の品番に変更した時に再利用可能金型リストに戻らない問題があった。

### 解決策の全体像

#### 1. 二重管理の問題
前月金型は以下の2つで管理される：
- **`prevMonthMoldsOriginal`**: サーバーから取得した元データ（不変）
- **`prevMonthMoldsStatus`**: 使用状態を管理（`used`フラグ）
- **`reusableMolds`**: 再利用可能金型のリスト（動的に更新）

問題は、`reusableMolds`リストから金型を削除しても、`prevMonthMoldsStatus[i].used`が`false`のままだと、次に`updateReusableMolds()`が呼ばれた時に再度リストに追加されてしまうこと。

#### 2. 修正ポイント

##### ① 再利用リストから引き継いだ時に`used=true`にマークする

```javascript
// searchOtherMachinesForCount() 内
if (reusablePrevMonthMold) {
    // prevMonthMoldsOriginalから該当する金型を探してused=trueにマーク
    for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
        const mold = prevMonthMoldsOriginal[i];
        if (mold.item_name === currentItem &&
            mold.used_count === reusablePrevMonthMold.count &&
            !mold.end_of_month &&
            !prevMonthMoldsStatus[i].used) {

            markPrevMonthMoldAsUsed(i, cellKey, dateIndex, shift, machineIndex, currentItem);
            break;
        }
    }

    // リストから削除
    reusableMolds.splice(moldIndexToRemove, 1);
}
```

**重要**: `markPrevMonthMoldAsUsed()`を呼ぶことで、`prevMonthMoldsStatus[i].used = true`になる。これにより、`updateReusableMolds()`が呼ばれた時に、`used=true`なのでリストに再度追加されない。

##### ② 重複チェックの追加

```javascript
// updateReusableMolds() 内
if (!mold.end_of_month && !prevMonthMoldsStatus[index].used && !prevMonthMoldsStatus[index].exhausted) {
    // 重複チェック: 同じ品番・同じカウントの金型が既にリストにある場合は追加しない
    const exists = reusableMolds.some(m =>
        m.dateIndex === -1 &&
        m.shift === 'prev_month' &&
        m.itemName === mold.item_name &&
        m.count === mold.used_count
    );

    if (!exists) {
        reusableMolds.push({ ... });
    }
}
```

**重要**: バックエンドで同じ品番の金型が複数回登録されている場合、重複チェックがないと同じ金型がリストに複数回追加されてしまう。

##### ③ 再計算時に既存の値を保持する

```javascript
// updateMoldCount() 内
const isPrevMonthMold = moldCountDisplay.getAttribute('data-prev-month-mold') === 'true';
if (isPrevMonthMold && currentItem) {
    const prevMonthItemName = moldCountDisplay.getAttribute('data-prev-month-item');
    const currentDisplayedCount = parseInt(moldCountDisplay.textContent) || 0;

    // 品番が一致し、既に表示されているカウントがある場合のみ、その値を保持
    if (currentItem === prevMonthItemName && currentDisplayedCount > 0) {
        // 既に計算済みのカウントをそのまま使用（再計算しない）
        return;
    }
}
```

**重要**: `data-prev-month-count`（元の前月のカウント）ではなく、`textContent`（現在表示されているカウント）を使う。これにより、引き継ぎ後にカウントが増えた状態を保持できる。

#### 3. データフロー

```
初期化:
prevMonthMoldsOriginal[3] = {item: VET2, count: 1, end_of_month: false}
prevMonthMoldsStatus[3] = {used: false}
reusableMolds = [{item: VET2, count: 1}]

1台目でVET2選択:
→ searchOtherMachinesForCount()
  → reusableMoldsから発見
  → markPrevMonthMoldAsUsed(3) → prevMonthMoldsStatus[3].used = true
  → reusableMoldsから削除
  → return count=2 (1+1)

updateReusableMolds()呼び出し:
→ prevMonthMoldsStatus[3].used = true なので追加しない
→ reusableMolds = [] (空)

2台目でVET2選択:
→ searchOtherMachinesForCount()
  → reusableMoldsは空
  → prevMonthMoldsOriginal[3]を確認 → used=true なので引き継げない
  → return count=1 (新規開始)

1台目の再計算:
→ updateMoldCount()
  → isPrevMonthMold=true, currentDisplayedCount=2
  → 既存の値(2)を保持してreturn（再計算しない）
```

### まとめ

前月金型の管理は、**`prevMonthMoldsStatus`の`used`フラグが真実の源泉**。
- 再利用リストから引き継いだ時も、`used=true`にマークする
- `updateReusableMolds()`は`used=false`の金型のみをリストに追加
- 再計算時は既存の表示値を保持する

これにより、1つの前月金型を複数の設備で引き継ぐことを防止できる。

## リファクタリング履歴

### 2025年11月29日
- `AutoCastingProductionPlanView`を`auto_casting_production_plan.py`に分離（1191行）
- `casting_production_plan.py`から削除（1976行→785行、60%削減）
- URL設定を更新（`management_room/urls/production_plan.py`）
- 目標から削除：在庫0下回らない制約、残業最小化
- 型替え時間設定を修正：1直目→前の品番の最終直
- 禁止パターンロジック修正：`>`→`>=`
- 6直分制約チェック機能追加：`can_assign_item_for_6_shifts()`
- 品番選定ロジック強化：月末在庫最小の品番を優先
- **禁止パターン計算ロジック変更**：`min(品番1, 品番2)`→`品番1 + 品番2`（合計台数で制限）
- **使用可能金型の管理改善**：
  - `end_of_month`フラグによる金型タイプの区別
  - 月末最終直の特定ロジック（土日対応）
  - 引き継ぎルールの分離（設備固定 vs 設備自由）
  - 再利用可能金型リスト表示の改善
- **前月金型の再利用可能リスト管理バグ修正**：
  - 再利用リストから引き継いだ時に`markPrevMonthMoldAsUsed()`を呼ぶ
  - `updateReusableMolds()`内で重複チェックを追加
  - 再計算時に既存の表示値を保持するように修正
  - 1つの前月金型を複数の設備で引き継ぐ問題を解決
