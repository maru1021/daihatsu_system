use context7

# 鋳造生産計画の金型管理システム

## 金型管理のルール

1. **型数の範囲**: 1→2→3→4→5→6のサイクル
2. **6直完了後**: 金型メンテナンス後、新しい金型を型数=1で開始
3. **途中で品番変更**: 使いかけの金型（型数1～5）は`detached_molds`に記録し、次に同じ品番を生産する時に引き継ぐ
4. **型数=0は存在しない**: 0は一時的な内部状態で、実際の金型としては無効

## バックエンド（Python）の重要ポイント

### 自動生産計画アルゴリズム（型替えイベント駆動アプローチ）

#### 目標優先順位
1. **在庫を0以下にしない**（絶対条件）
2. **矢印を最小化**（6直連続生産を優先し、型替え回数を削減）
3. **全品番の残個数を均等化**（月末予測在庫の偏りを最小化）
4. **適正在庫周辺を保つ**
5. **残業時間を最小化**

#### アルゴリズムの流れ

##### 1. 初期化フェーズ
- 前月最終在庫、使用可能金型、品番ペア制約などを取得
- 前月から継続する設備の型数を引き継ぎ
- 次の型替えタイミング（`next_changeover_timing`）を計算
  - 前月から継続する場合: `MOLD_CHANGE_THRESHOLD - shift_count`（残り直数）
  - 未設定の場合: 0（最初の直から開始）

##### 2. 型替えイベント駆動メインループ
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
        # 型替え時間を設定（1直目が品番変更時、6直目）

    # 次の型替えタイミングを更新
    next_changeover_timing[machine_id] = next_timing + MOLD_CHANGE_THRESHOLD
```

##### 3. 緊急度判定（`find_most_urgent_item`）
- 各品番について、生産しない場合の将来在庫をシミュレーション
- 在庫がマイナスになる直があれば「緊急」と判定
- 最も早く在庫切れする品番を選択（fail_idxが小さい順、同じなら現在在庫が少ない順）
- 品番ペア制約（`prohibited_patterns`）と同一品番上限（2台まで）をチェック

##### 4. 金型カウント設定

**品番変更時**（`set_mold_count_for_item_change`）:
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

**継続時**（`set_mold_count_for_continue`）:
```python
# 型数=0（6直完了後）の場合、使いかけ金型を引き継ぐ
if shift_count == 0 and item_name in detached_molds:
    inherited_count = detached_molds[item_name].pop(0)
    new_mold_count = inherited_count + 1
else:
    new_mold_count = shift_count + 1  # 通常は+1
```

##### 5. 型替え時間の設定
**重要**: 型替え時間は常に**前の品番の最終直**に設定する

- **6直目**: 常に`CHANGEOVER_TIME`を設定（金型メンテナンス）
- **品番変更（型替えイベント駆動）**:
  - 前の品番の6直目に型替え時間が既に設定済み
  - 新しい品番の1直目には型替え時間は**不要**（金型は既に取り付けられている）
- **夜勤→日勤で品番変更**:
  - 夜勤（前の品番の最終直）に型替え時間を設定
  - 夜勤の残業を0に設定（型替え作業のため）
  - 日勤の型替え時間をクリア（夜勤で型替え済み）
- **日勤→夜勤で品番変更**:
  - 日勤（前の品番の最終直）に型替え時間を設定

##### 6. 残業時間の最適化（`_optimize_overtime`）
2段階アプローチで過剰在庫を防ぐ:
1. 上限残業で在庫シミュレーション
2. 過剰在庫になる直の残業を削減（適正在庫の2倍以上）
3. 在庫不足になる直の残業は確保

### 金型記録条件
- `detached_molds`には型数1～5のみ記録（0と6は記録しない）
- 金型は全設備で共有されるため、設備IDは含めない
- 同一品番でも複数の使いかけ金型が存在する可能性があるためリスト形式

### 二重記録の防止
- 同じ直で同じ金型を複数回記録しない（`detached_current_mold`フラグで制御）

### 前月からの引き継ぎ
```python
# end_of_month=Trueのデータのみ取得
if 0 < mold['used_count'] < MOLD_CHANGE_THRESHOLD:
    machine_current_item[machine_id] = item_name
    machine_shift_count[machine_id] = mold['used_count']
    # 注意: detached_moldsには記録しない（設備に取り付けられた状態で開始）
```

前月から継続する設備は、メインループの前に計画を立てる:
```python
for machine in machines:
    if current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD:
        # 残り直数分の計画を立てる
        remaining_shifts = MOLD_CHANGE_THRESHOLD - shift_count
        for i in range(remaining_shifts):
            # 計画を追加
            current_mold_count = shift_count + i + 1
```

### 在庫シミュレーション（`simulate_future_inventory_for_item`）
特定の品番について、将来在庫をシミュレーションし、マイナスになるかチェック:
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

### 品番割り当て可能性チェック（`can_assign_item`）
```python
def can_assign_item(item_name, assigned_items_count, prohibited_patterns):
    MAX_MACHINES_PER_ITEM = 2

    # 同一品番の上限チェック
    if assigned_items_count.get(item_name, 0) >= MAX_MACHINES_PER_ITEM:
        return False

    # 品番ペア制約チェック
    for other_item, other_count in assigned_items_count.items():
        pair_key = f"{item_name}_{other_item}"
        pair_limit = prohibited_patterns.get(pair_key)

        if pair_limit is not None:
            pair_count = min(new_item_count, other_count)
            if pair_count > pair_limit:
                return False

    return True
```

### ログ出力
デバッグ用に詳細なログを`inventory_simulation_log.txt`に出力:
- 初期状態と次の型替えタイミング
- 前月から継続する設備の計画
- 各直の出荷・生産・在庫処理
- 型替えイベント（品番決定）
- 使いかけ金型の状態

## フロントエンド（JavaScript）の重要ポイント

### 金型引き継ぎの管理

#### 1. 引き継ぎ情報の双方向管理
引き継ぎは双方向で管理される：
- **引き継ぎ元**: `data-mold-inheritance-target`属性（引き継ぎ先への参照）
- **引き継ぎ先**: `data-mold-inheritance`属性（引き継ぎ元への参照）
- **矢印表示**: 他設備からの引き継ぎのみ表示（同一設備継続では矢印なし）

**重要**: 同一設備継続でも、引き継ぎ先に`data-mold-inheritance`を設定する。これにより、引き継ぎ先が変更された時に引き継ぎ元を特定できる。

#### 2. 同一設備での継続優先
同一設備での継続は、他設備からの引き継ぎよりも優先される。

**処理手順**:
1. 引き継ぎ元から既存のターゲットへの参照を完全に削除
2. 既存のターゲットの引き継ぎ情報をクリア
3. 現在の設備の引き継ぎ元への新しい参照を設定
4. 既存のターゲットを再計算

この順序により、既存のターゲットは引き継ぎ元を使えなくなり、他の金型を探すかcount=1になる。

#### 3. 品番変更時の引き継ぎクリア
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

**具体例**:
- 金曜night #4 VE4 → 月曜day #0 VE4, #3 VE4（複数の設備が同じ引き継ぎ元を参照）
- #3をVE5に変更すると：
  - 全体クリアで、金曜night #4の`data-mold-inheritance-target`（VE4への参照）を削除
  - #0は引き継ぎを維持、#3はVE5として新規開始

#### 4. 矢印描画時の品番チェック
矢印を描画する際、引き継ぎ元の現在の品番と`data-mold-inheritance-target`の`itemName`が一致しているかチェック。品番が一致しない場合は矢印を描画しない。

## 注意事項

### バックエンド（自動生産計画）
- **型数は必ず1～6の範囲**（0は一時状態で、次の直で1から開始）
- **`detached_molds`には型数1～5のみ記録**（0と6は記録しない）
- **金型は全設備で共有**（`detached_molds`に設備IDは含めない）
- **同じ直で同じ金型を複数回記録しない**（`detached_current_mold`フラグで制御）
- **6直分の計画を一度に立てる**（型替えイベント駆動）
- **前月から継続する設備はメインループの前に処理**
- **型替えタイミングは残り直数で管理**（`next_changeover_timing`）
- **型替え時間の設定タイミング**:
  - 品番変更時: 1直目
  - 6直目: 常に
  - 夜勤→日勤で品番変更: 夜勤
  - 日勤→夜勤で品番変更: 日勤
- **生産数は不良品も含むが、在庫に加算するのは良品のみ**（yield_rateを考慮）

### フロントエンド（金型引き継ぎ）
- **引き継ぎ元には必ず`data-mold-inheritance-target`を設定**（同一設備継続でも他設備引き継ぎでも）
- **引き継ぎ先には必ず`data-mold-inheritance`を設定**（同一設備継続でも設定、矢印は他設備引き継ぎのみ）
- **品番変更時は、前方向・後方向・全体の3方向でクリアが必要**
- **同一設備での継続優先時は、`removeAttribute`→新規設定→再計算の順序を厳守**
