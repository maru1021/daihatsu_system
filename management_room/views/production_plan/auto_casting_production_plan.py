"""
鋳造生産計画の自動生成ビュー

【金型管理の重要ルール】
1. 型数の範囲: 1→2→3→4→5→6のサイクル（型数0は一時的な内部状態）
2. 6直完了後: 金型メンテナンス後、新しい金型を型数=1で開始
3. 途中で品番変更: 使いかけの金型（型数1～5）はdetached_moldsに記録し、次に同じ品番を生産する時に引き継ぐ
4. 金型カウントの保存・引継ぎ:
   - 保存: この直で使用後の型数（shift_count + 1）を保存
   - 引継: 保存された型数をそのまま使用（既に+1済みのため）
5. end_of_month=Falseの金型: 前月の途中で取り外された金型は、次月でused_count+1から開始

【型替えイベント駆動アプローチ】
- 各設備の次の型替えタイミングを管理し、最も早いタイミングで品番を決定
- 型数に応じた生産直数を計算（型数2から開始なら5直分生産して型数6で完了）
- 前月から継続する設備は、残り直数を計算して型替えタイミングを設定
"""

from management_room.models import DailyMachineCastingProductionPlan, DailyCastingProductionPlan, CastingItem, CastingItemMachineMap, MachiningItemCastingItemMap, DailyMachiningProductionPlan, UsableMold, CastingItemProhibitedPattern
from manufacturing.models import CastingLine, CastingMachine
from management_room.auth_mixin import ManagementRoomPermissionMixin
from django.views import View
from django.http import JsonResponse
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
import json
import math
from utils.days_in_month_dates import days_in_month_dates
from collections import defaultdict

class AutoCastingProductionPlanView(ManagementRoomPermissionMixin, View):
    """
    鋳造生産計画の自動生成

    型替えイベント駆動アプローチを使用し、在庫切れを防ぎながら
    型替え回数を最小化する生産計画を生成する。
    """

    def post(self, request, *args, **kwargs):
        try:
            # パラメータ取得
            data = json.loads(request.body)

            year = data.get('year')
            month = data.get('month')
            line_id = data.get('line_id')
            stop_time_data = data.get('stop_time_data', [])  # 計画停止データ
            weekend_work_dates = data.get('weekend_work_dates', [])  # 休出日リスト

            if not all([year, month, line_id]):
                return JsonResponse({
                    'status': 'error',
                    'message': '必要なパラメータが不足しています'
                }, status=400)

            line = CastingLine.objects.get(id=line_id)
            machines = list(CastingMachine.objects.filter(line=line, active=True).order_by('name'))

            # 対象期間を計算（days_in_month_dates関数を使用）
            date_list = days_in_month_dates(year, month)
            start_date = date_list[0]
            end_date = date_list[-1]

            # 稼働日のリスト（平日 + 休出日）を作成
            weekend_work_date_objs = [datetime.strptime(d, '%Y-%m-%d').date() for d in weekend_work_dates]
            working_days = []
            for d in date_list:
                is_weekday = d.weekday() < 5  # 月曜〜金曜
                is_weekend_work = d in weekend_work_date_objs
                if is_weekday or is_weekend_work:
                    working_days.append(d)

            # 品番リストと出庫数を取得（DailyCastingProductionPlanから）
            delivery_plans = DailyCastingProductionPlan.objects.filter(
                line=line,
                date__gte=start_date,
                date__lte=end_date
            ).select_related('production_item')

            # 鋳造品番と加工品番の紐づけを取得
            casting_to_machining_map = {}
            item_maps = MachiningItemCastingItemMap.objects.filter(
                casting_line_name=line.name,
                active=True
            )
            for item_map in item_maps:
                casting_key = item_map.casting_item_name
                if casting_key not in casting_to_machining_map:
                    casting_to_machining_map[casting_key] = []
                casting_to_machining_map[casting_key].append({
                    'machining_line_name': item_map.machining_line_name,
                    'machining_item_name': item_map.machining_item_name
                })

            # 加工生産計画データを取得（出庫数のデフォルト値として使用）
            machining_plans = DailyMachiningProductionPlan.objects.filter(
                date__gte=start_date,
                date__lte=end_date
            ).select_related('production_item', 'line')

            # 加工生産計画を辞書化
            machining_plans_dict = {}
            for plan in machining_plans:
                if plan.production_item and plan.line:
                    key = (plan.line.name, plan.production_item.name, plan.date, plan.shift)
                    if key not in machining_plans_dict:
                        machining_plans_dict[key] = []
                    machining_plans_dict[key].append(plan)

            # 品番ごとの出庫数を集計（日付・シフト別）
            item_delivery = {}

            # 出庫数は常に加工生産計画から取得（holding_out_countフィールドは削除済み）

            # 全品番、全日付、全シフトをループ
            casting_items = CastingItem.objects.filter(line=line, active=True)
            for item in casting_items:
                item_name = item.name
                item_delivery[item_name] = []

                for current_date in date_list:
                    for shift in ['day', 'night']:
                        # 加工生産計画から出庫数を取得
                        delivery = 0
                        machining_items = casting_to_machining_map.get(item_name, [])
                        total_production = 0
                        for machining_item_info in machining_items:
                            machining_key = (
                                machining_item_info['machining_line_name'],
                                machining_item_info['machining_item_name'],
                                current_date,
                                shift
                            )
                            machining_plans_list = machining_plans_dict.get(machining_key, [])
                            for machining_plan in machining_plans_list:
                                if machining_plan.production_quantity:
                                    total_production += machining_plan.production_quantity
                        if total_production > 0:
                            delivery = total_production

                        if delivery > 0:
                            item_delivery[item_name].append({
                                'date': current_date,
                                'shift': shift,
                                'count': delivery
                            })

            # 前月最終在庫を取得（DailyCastingProductionPlanから）
            first_day_of_month = date(year, month, 1)
            prev_month_last_date = first_day_of_month - relativedelta(days=1)

            prev_inventory = {}
            prev_stock_plans = DailyCastingProductionPlan.objects.filter(
                line=line,
                date=prev_month_last_date,
                shift='night'
            ).select_related('production_item')

            for plan in prev_stock_plans:
                if plan.production_item and plan.stock is not None:
                    item_name = plan.production_item.name
                    prev_inventory[item_name] = plan.stock

            # 適正在庫を取得
            optimal_inventory = {}
            casting_items = CastingItem.objects.filter(line=line, active=True)
            for item in casting_items:
                optimal_inventory[item.name] = item.optimal_inventory or 0

            # 品番マスタデータを取得（品番×鋳造機のペア）
            item_data = {}
            item_maps = CastingItemMachineMap.objects.filter(
                line=line,
                active=True
            ).select_related('casting_item', 'machine')
            for item_map in item_maps:
                # 品番と鋳造機のペアをキーにする
                key = f"{item_map.casting_item.name}_{item_map.machine.id}"
                item_data[key] = {
                    'name': item_map.casting_item.name,
                    'tact': item_map.tact or 0,
                    'yield_rate': item_map.yield_rate or 0,
                    'machine': item_map.machine,
                    'machine_id': item_map.machine.id
                }

            # 前月の使用可能金型数を取得
            prev_usable_molds = {}
            prev_detached_molds = {}  # 前月の途中で外した使いかけ金型
            prev_month_first_date = date(prev_month_last_date.year, prev_month_last_date.month, 1)

            molds = UsableMold.objects.filter(
                line=line,
                month=prev_month_first_date
            ).select_related('machine', 'item_name')

            # デバッグログ: 前月の使用可能金型を読み込み
            print(f"\n=== 前月の使用可能金型を読み込み（{prev_month_first_date}） ===")

            for mold in molds:
                if mold.end_of_month:
                    # 月末金型（設備に取り付けられている状態）
                    key = f"{mold.machine.id}_{mold.item_name.name}"
                    prev_usable_molds[key] = {
                        'machine_id': mold.machine.id,
                        'item_name': mold.item_name.name,
                        'used_count': mold.used_count,
                        'end_of_month': mold.end_of_month
                    }
                    print(f"  月末金型: 設備#{mold.machine.name} {mold.item_name.name} 型数={mold.used_count}")
                else:
                    # 月の途中で外した使いかけの金型（detached_moldsに追加）
                    # used_count が 1～5 の範囲（6直完了は除外）
                    if 0 < mold.used_count < 6:
                        item_name = mold.item_name.name
                        if item_name not in prev_detached_molds:
                            prev_detached_molds[item_name] = []

                        # 【重要】DBに保存されているused_countは取り外し時の値
                        # 次回使用時は+1した値から開始する（フロントエンドでは取り外し時のカウントをそのまま保存）
                        next_count = mold.used_count + 1
                        prev_detached_molds[item_name].append(next_count)
                        print(f"  途中取外: {item_name} DB型数={mold.used_count} → 次回使用時={next_count}")

            print(f"\n前月取外金型の初期状態: {dict(prev_detached_molds)}\n")

            # 品番ペアごとの同時生産上限を取得
            prohibited_patterns = {}
            patterns = CastingItemProhibitedPattern.objects.filter(
                line=line,
                active=True
            ).select_related('item_name1', 'item_name2')

            for pattern in patterns:
                item1 = pattern.item_name1.name
                item2 = pattern.item_name2.name
                # 両方向のキーで登録（順序に依存しないように）
                prohibited_patterns[f"{item1}_{item2}"] = pattern.count or 2
                prohibited_patterns[f"{item2}_{item1}"] = pattern.count or 2

            # 自動生産計画を生成
            result = self._generate_auto_plan(
                working_days=working_days,
                machines=machines,
                item_delivery=item_delivery,
                prev_inventory=prev_inventory,
                optimal_inventory=optimal_inventory,
                item_data=item_data,
                stop_time_data=stop_time_data,
                prev_usable_molds=prev_usable_molds,
                prev_detached_molds=prev_detached_molds,
                prohibited_patterns=prohibited_patterns,
                line=line,
                occupancy_rate=line.occupancy_rate or 1.0
            )

            return JsonResponse({
                'status': 'success',
                'data': result.get('plans', []),
                'unused_molds': result.get('unused_molds', [])  # 使用されなかった金型データ
            })

        except Exception as e:
            import traceback
            return JsonResponse({
                'status': 'error',
                'message': str(e),
                'traceback': traceback.format_exc()
            }, status=400)

    def _generate_auto_plan(self, working_days, machines, item_delivery, prev_inventory,
                           optimal_inventory, item_data, stop_time_data, prev_usable_molds,
                           prev_detached_molds, prohibited_patterns, line, occupancy_rate):
        """
        自動生産計画を生成する（在庫最適化 + 金型交換最小化）

        【型替えイベント駆動アルゴリズム】
        目標:
        1. 矢印を最小化（6直連続生産を優先し、型替え回数を削減）
        2. 全品番の残個数を均等化（月末予測在庫の偏りを最小化）
        3. 適正在庫周辺を保つ

        品番選定ロジック:
        1. 6直分すべての直で禁止パターンに違反しない品番のみを候補とする
        2. 最優先: 将来在庫がマイナスになる品番（最も早く在庫切れする順）
        3. 在庫切れがない場合: 月末在庫が最小になる品番

        Args:
            working_days (list): 稼働日リスト
            machines (list): 設備リスト
            item_delivery (dict): 出庫計画 {品番: [{'date': date, 'shift': str, 'count': int}]}
            prev_inventory (dict): 前月末在庫 {品番: 個数}
            optimal_inventory (dict): 適正在庫 {品番: 個数}
            item_data (dict): 品番-設備マスタデータ {key: {'name': str, 'tact': float, 'yield_rate': float, 'machine_id': int}}
            stop_time_data (list): 計画停止データ [{'date': date, 'shift': str, 'machine_id': int, 'stop_time': int}]
            prev_usable_molds (dict): 前月からの使用可能金型 {key: {'machine_id': int, 'item_name': str, 'used_count': int}}
            prohibited_patterns (dict): 品番ペア制約 {'品番A_品番B': 上限台数}
            line: 鋳造ライン
            occupancy_rate (float): 稼働率

        Returns:
            dict: {
                'machine_plans': {machine_id: [plan_dict, ...]},
                'unused_molds': [{'item_name': str, 'used_count': int}, ...]
            }

        アルゴリズムの流れ:
        1. 初期化: 変数、定数、ログファイルの設定
        2. 前月からの引き継ぎ: 使いかけ金型の状態を復元
        3. イベント駆動メインループ:
           - 最も早い型替えタイミングを持つ設備を特定
           - そのタイミングまでの在庫・出荷・生産を処理
           - 型替えタイミングで最も緊急度の高い品番を選定
           - 6直分の計画を一度に立てる
        4. 残りの直の処理: ループ終了後の在庫・出荷処理
        5. 型替え時間ルールの適用: 夜勤→日勤、日勤→夜勤の品番変更時
        6. 結果フォーマット: JSON形式で返却

        重要な実装ルール:
        - 型替え時間は常に**前の品番の最終直**に設定（1直目ではない）
        - 6直目には必ず型替え時間を設定（金型メンテナンス）
        - 品番変更時は、前の品番の最終直に型替え時間を追加設定
        """
        import os
        from datetime import datetime

        # 定数
        BASE_TIME = {'day': 490, 'night': 485}  # 基本稼働時間（分）
        OVERTIME_MAX = {'day': 120, 'night': 60}  # 残業上限（分）
        SAFETY_STOCK = 300  # 安全在庫（この値を下回らないようにする）
        MOLD_CHANGE_THRESHOLD = 6  # 金型交換閾値
        CHANGEOVER_TIME = line.changeover_time or 90  # 型替え時間（分）

        # ログファイルの設定
        log_dir = os.path.dirname(os.path.abspath(__file__))
        log_file_path = os.path.join(log_dir, 'inventory_simulation_log.txt')

        # 既存のログファイルを削除
        if os.path.exists(log_file_path):
            os.remove(log_file_path)

        # ログファイルを開く
        log_file = open(log_file_path, 'w', encoding='utf-8')
        log_file.write("=" * 80 + "\n")
        log_file.write("鋳造生産計画 在庫シミュレーションログ\n")
        log_file.write(f"生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        log_file.write("=" * 80 + "\n\n")

        # 全シフトのリスト（日付×シフト）
        # 土日（休出）は日勤のみ
        all_shifts = []
        for date in working_days:
            all_shifts.append((date, 'day'))
            # 土日（weekday: 5=土曜, 6=日曜）は夜勤なし
            if date.weekday() < 5:
                all_shifts.append((date, 'night'))

        # 計画停止データを辞書化: {(date, shift, machine_id): stop_time}
        stop_time_dict = {}
        for stop in stop_time_data:
            key = (stop['date'], stop['shift'], stop['machine_id'])
            stop_time_dict[key] = stop['stop_time']

        # 品番リストを作成
        all_item_names = set()
        for key, data in item_data.items():
            all_item_names.add(data['name'])

        # 在庫シミュレーション用の変数を初期化
        inventory = {item: prev_inventory.get(item, 0) for item in all_item_names}

        # 各鋳造機の生産計画
        machine_plans = {m.id: [] for m in machines}

        # 各鋳造機の現在の品番と連続直数
        machine_current_item = {}
        machine_shift_count = {}

        # 途中で取り外した金型の使用回数を記録（品番ごと）
        # {item_name: [used_count1, used_count2, ...]}
        # 金型は全設備で共有されるため、設備IDは含めない
        # 同一品番でも複数の使いかけ金型が存在する可能性があるためリスト形式
        # 6直目で外した金型は記録しない（メンテ済みで次は1から）
        # 前月の使いかけ金型を引き継ぐ
        detached_molds = prev_detached_molds.copy()

        # 金型使用管理（前月からの引き継ぎ）
        # 前月最終直に各設備についていた金型と使用回数を設定
        for key, mold in prev_usable_molds.items():
            # end_of_month=Trueのデータのみ取得しているので、used_count < 6 の条件のみチェック
            # 0は無効な値なので除外（1～5のみ引き継ぐ）
            if 0 < mold['used_count'] < MOLD_CHANGE_THRESHOLD:
                # 月末金型で1～5なら引き継ぎ
                machine_id = mold['machine_id']
                item_name = mold['item_name']

                # 初期品番として設定
                machine_current_item[machine_id] = item_name
                # 使用回数を引き継ぎ
                machine_shift_count[machine_id] = mold['used_count']

                # 注意: detached_moldsには記録しない
                # 設備に取り付けられた状態で開始するため、途中で外した金型ではない

        # ========================================
        # ヘルパー関数定義
        # ========================================

        def set_mold_count_for_item_change(machine_id, current_item, new_item, shift_count, detached_molds, detached_current_mold):
            """
            品番変更時の型数を設定する

            【動作】
            1. 現在の品番の使いかけ金型を記録（型数1～5の場合）
            2. 新しい品番の使いかけ金型があれば引き継ぐ、なければ型数1で開始

            【金型カウントの保存・引継ぎルール】
            - 保存: この直で使用後の型数（shift_count + 1）を保存
            - 引継: 保存された型数をそのまま使用（既に+1済みのため）

            Args:
                machine_id: 設備ID
                current_item: 現在の品番
                new_item: 新しい品番
                shift_count: 現在の型数
                detached_molds: 使いかけ金型の辞書 {item_name: [count1, count2, ...]}
                detached_current_mold: 現在の金型を記録済みかのフラグ

            Returns:
                (new_mold_count, updated_detached_current_mold): 新しい型数と更新されたフラグ
            """
            # 1. 現在の品番の使いかけ金型を記録（1～5の場合、かつまだ記録していない場合）
            if not detached_current_mold and current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD:
                if current_item not in detached_molds:
                    detached_molds[current_item] = []
                detached_molds[current_item].append(shift_count + 1)
                detached_current_mold = True

            # 2. 新しい品番の使いかけ金型があれば引き継ぐ
            if new_item in detached_molds and len(detached_molds[new_item]) > 0:
                inherited_count = detached_molds[new_item].pop(0)
                new_mold_count = inherited_count
                # リストが空になったら辞書から削除
                if len(detached_molds[new_item]) == 0:
                    del detached_molds[new_item]
            else:
                new_mold_count = 1

            return (new_mold_count, detached_current_mold)

        def set_mold_count_for_continue(machine_id, item_name, shift_count, detached_molds):
            """
            同じ品番を継続する場合の型数を設定する

            【動作】
            - 型数0（6直完了後）: 使いかけ金型があれば引き継ぐ、なければ型数1で開始
            - 型数1～5: 前の直+1で継続

            Args:
                machine_id: 設備ID
                item_name: 品番
                shift_count: 現在の型数
                detached_molds: 使いかけ金型の辞書 {item_name: [count1, count2, ...]}

            Returns:
                new_mold_count: 新しい型数
            """
            # 型数0（6直完了後）の場合、使いかけ金型を引き継ぐ
            if shift_count == 0 and item_name in detached_molds and len(detached_molds[item_name]) > 0:
                inherited_count = detached_molds[item_name].pop(0)
                new_mold_count = inherited_count
                # リストが空になったら辞書から削除
                if len(detached_molds[item_name]) == 0:
                    del detached_molds[item_name]
            else:
                # 通常は前の直+1で継続
                new_mold_count = shift_count + 1

            return new_mold_count

        def calculate_estimated_production(item_name, machine_id, shift, stop_time=0, overtime=0):
            """指定した品番・設備での推定生産数を計算"""
            key = f"{item_name}_{machine_id}"
            data = item_data.get(key)

            if not data or data['tact'] == 0:
                return 0

            working_time = BASE_TIME[shift] - stop_time + overtime
            if working_time < 0:
                working_time = 0

            # 生産数は不良品も含めた数量（不良率を掛けない）
            production = math.floor(
                (working_time / data['tact']) * occupancy_rate
            )
            return production

        def simulate_future_inventory_for_item(item_name, from_shift_idx, temp_machine_plans):
            """特定の品番の将来在庫をシミュレーション（マイナスになる直があるかチェック）"""
            # 現在の在庫から開始
            simulated_inv = inventory.get(item_name, 0)

            # from_shift_idxから月末までシミュレーション
            for idx in range(from_shift_idx, len(all_shifts)):
                sim_date, sim_shift = all_shifts[idx]

                # この直での出庫数
                delivery = 0
                for d in item_delivery.get(item_name, []):
                    if d['date'] == sim_date and d['shift'] == sim_shift:
                        delivery = d['count']
                        break

                # 出庫
                simulated_inv -= delivery

                # 生産数を計算（不良品も含む数量）して、在庫に加算する際は不良率を考慮（良品のみ）
                for machine in machines:
                    # この設備のこの直の計画を取得
                    plan_list = [p for p in temp_machine_plans[machine.id]
                                if p['date'] == sim_date and p['shift'] == sim_shift]

                    if plan_list and plan_list[0]['item_name'] == item_name:
                        plan = plan_list[0]
                        stop_time = plan.get('stop_time', 0)
                        overtime = plan.get('overtime', OVERTIME_MAX[sim_shift])
                        production = calculate_estimated_production(
                            item_name, machine.id, sim_shift, stop_time, overtime
                        )
                        # 在庫に加算する際は不良率を考慮（良品のみ）
                        key = f"{item_name}_{machine.id}"
                        yield_rate = item_data.get(key, {}).get('yield_rate', 1.0)
                        simulated_inv += math.floor(production * yield_rate)

                # マイナスになる直があればFalseを返す
                if simulated_inv < 0:
                    return False, simulated_inv, idx

            return True, simulated_inv, -1

        def calculate_end_of_month_inventory_all_items(temp_machine_plans):
            """全品番の月末予測在庫を計算"""
            eom_inventory = {}

            for item_name in all_item_names:
                simulated_inv = inventory.get(item_name, 0)

                # 月初から月末までシミュレーション
                for idx in range(len(all_shifts)):
                    sim_date, sim_shift = all_shifts[idx]

                    # この直での出庫数
                    delivery = 0
                    for d in item_delivery.get(item_name, []):
                        if d['date'] == sim_date and d['shift'] == sim_shift:
                            delivery = d['count']
                            break

                    # 出庫
                    simulated_inv -= delivery

                    # 生産数を計算（不良品も含む数量）して、在庫に加算する際は不良率を考慮（良品のみ）
                    for machine in machines:
                        plan_list = [p for p in temp_machine_plans[machine.id]
                                    if p['date'] == sim_date and p['shift'] == sim_shift]

                        if plan_list and plan_list[0]['item_name'] == item_name:
                            plan = plan_list[0]
                            stop_time = plan.get('stop_time', 0)
                            overtime = plan.get('overtime', OVERTIME_MAX[sim_shift])
                            production = calculate_estimated_production(
                                item_name, machine.id, sim_shift, stop_time, overtime
                            )
                            # 在庫に加算する際は不良率を考慮（良品のみ）
                            key = f"{item_name}_{machine.id}"
                            yield_rate = item_data.get(key, {}).get('yield_rate', 1.0)
                            simulated_inv += math.floor(production * yield_rate)

                eom_inventory[item_name] = simulated_inv

            return eom_inventory

        def can_assign_item(item_name, assigned_items_count, prohibited_patterns):
            """指定した品番を割り当てられるかチェック（1つの直における制約）"""
            MAX_MACHINES_PER_ITEM = 2

            # 同一品番の上限チェック
            if assigned_items_count.get(item_name, 0) >= MAX_MACHINES_PER_ITEM:
                return False

            # 品番ペア制約チェック
            # この品番を追加した場合のカウント
            new_item_count = assigned_items_count.get(item_name, 0) + 1

            for other_item, other_count in assigned_items_count.items():
                if other_item == item_name or other_count == 0:
                    continue

                pair_key = f"{item_name}_{other_item}"
                pair_limit = prohibited_patterns.get(pair_key)

                if pair_limit is not None:
                    # この品番を追加した場合の合計台数
                    total_count = new_item_count + other_count
                    # pair_limit以上は禁止（例: pair_limit=3の場合、合計3台以上は禁止）
                    if total_count >= pair_limit:
                        return False

            return True

        def can_assign_item_for_6_shifts(item_name, current_shift_idx, machine_id, prohibited_patterns):
            """
            6直分すべての直で禁止パターンに違反しないかチェック

            Args:
                item_name: 割り当てたい品番
                current_shift_idx: 開始直のインデックス
                machine_id: 割り当て先の設備ID
                prohibited_patterns: 品番ペア制約

            Returns:
                bool: 6直すべてで制約を満たす場合True
            """
            MAX_MACHINES_PER_ITEM = 2

            # 6直分をチェック（ただし計画期間を超えない範囲）
            for i in range(min(MOLD_CHANGE_THRESHOLD, len(all_shifts) - current_shift_idx)):
                shift_idx = current_shift_idx + i
                if shift_idx >= len(all_shifts):
                    break

                shift_date, shift_name = all_shifts[shift_idx]

                # この直で既に割り当てられている品番をカウント
                assigned_items_count = {}
                for m in machines:
                    # 自分自身の設備は除外（これから割り当てるので）
                    if m.id == machine_id:
                        continue

                    # この直の計画を取得
                    plan_list = [p for p in machine_plans[m.id]
                               if p['date'] == shift_date and p['shift'] == shift_name]
                    if plan_list:
                        item = plan_list[0]['item_name']
                        assigned_items_count[item] = assigned_items_count.get(item, 0) + 1

                # この品番を追加できるかチェック
                if not can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                    # デバッグ: どの直で制約違反したか記録
                    log_file.write(f"    【6直チェック】直{i+1}/{shift_date} {shift_name}: {item_name} 追加不可（現在の割当: {assigned_items_count}）\n")
                    return False

            return True

        def find_most_urgent_item(machine_items, current_shift_idx, machine_id, assigned_items_count, prohibited_patterns):
            """
            最も緊急度の高い品番を見つける

            優先順位:
            1. 将来在庫がマイナスになる品番（最も早く在庫切れする順）
            2. 在庫切れがない場合は、月末在庫が最小の品番

            重要: 6直分すべての直で禁止パターンに違反しない品番のみを候補とする

            Args:
                machine_items: この設備で生産可能な品番リスト
                current_shift_idx: 開始直のインデックス
                machine_id: 割り当て先の設備ID
                assigned_items_count: 現在の直で既に割り当てられている品番のカウント
                prohibited_patterns: 品番ペア制約

            Returns:
                最も緊急度の高い品番名、またはNone
            """
            urgent_items = []
            safe_items = []

            for item_name in machine_items:
                # 1. 現在の直での制約チェック
                if not can_assign_item(item_name, assigned_items_count, prohibited_patterns):
                    continue

                # 2. 6直分すべての直での制約チェック
                can_assign_6shifts = can_assign_item_for_6_shifts(item_name, current_shift_idx, machine_id, prohibited_patterns)
                if not can_assign_6shifts:
                    # デバッグログ: 6直分チェックで除外された品番
                    log_file.write(f"  【6直分チェック】{item_name} は除外されました（禁止パターン違反）\n")
                    continue

                # この品番を生産しない場合の将来在庫をシミュレーション
                temp_plans = {m.id: list(machine_plans[m.id]) for m in machines}
                is_safe, end_inv, fail_idx = simulate_future_inventory_for_item(
                    item_name, current_shift_idx, temp_plans
                )

                if not is_safe:
                    # 将来在庫がマイナスになる = 緊急
                    # fail_idxが小さいほど早く在庫切れ = より緊急
                    current_stock = inventory.get(item_name, 0)
                    urgent_items.append((item_name, fail_idx, current_stock))
                else:
                    # 在庫切れしない品番は月末在庫数を記録
                    safe_items.append((item_name, end_inv))

            if urgent_items:
                # 最も早く在庫切れする品番を選択（fail_idxが小さい順、同じなら現在在庫が少ない順）
                urgent_items.sort(key=lambda x: (x[1], x[2]))
                return urgent_items[0][0]

            if safe_items:
                # 在庫切れがない場合、月末在庫が最小の品番を選択
                safe_items.sort(key=lambda x: x[1])
                return safe_items[0][0]

            return None

        # ========================================
        # 【新アルゴリズム】型替えイベント駆動アプローチ
        # ========================================

        # 各設備の次の型替えタイミング（直インデックス）を管理
        # 前月から継続する場合: 残り直数を計算
        # 未設定の場合: 0（最初の直から開始）
        next_changeover_timing = {}

        for machine in machines:
            current_item = machine_current_item.get(machine.id)
            shift_count = machine_shift_count.get(machine.id, 0)

            if current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD:
                # 前月から継続: 残り直数を計算（例: shift_count=4 なら、あと2直で型替え）
                remaining_shifts = MOLD_CHANGE_THRESHOLD - shift_count
                next_changeover_timing[machine.id] = remaining_shifts
            else:
                # 未設定または型替えタイミング: 最初の直から開始
                next_changeover_timing[machine.id] = 0

        # 処理済みの直インデックス（在庫シミュレーション用）
        processed_shift_idx = 0

        # ログ: 初期状態
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【初期状態】\n")
        log_file.write("=" * 80 + "\n\n")
        log_file.write("--- 各設備の初期状態と次の型替えタイミング ---\n")
        for machine in machines:
            current_item = machine_current_item.get(machine.id)
            shift_count = machine_shift_count.get(machine.id, 0)
            timing = next_changeover_timing.get(machine.id, 0)
            if current_item:
                log_file.write(f"  設備#{machine.name}: {current_item} (型数={shift_count}), 次の型替え: {timing}直後\n")
            else:
                log_file.write(f"  設備#{machine.name}: (未設定), 次の型替え: {timing}直後\n")
        log_file.write("\n")

        # 前月から継続する設備の計画を立てる
        log_file.write("--- 前月から継続する設備の計画 ---\n")
        for machine in machines:
            current_item = machine_current_item.get(machine.id)
            shift_count = machine_shift_count.get(machine.id, 0)
            timing = next_changeover_timing.get(machine.id, 0)

            if current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD and timing > 0:
                # 前月から継続: 最初の直から型替えタイミングまでの計画を立てる
                log_file.write(f"  設備#{machine.name}: {current_item} を型数={shift_count+1}から{shift_count+timing}まで生産\n")

                for i in range(timing):
                    shift_idx = i
                    if shift_idx >= len(all_shifts):
                        break

                    plan_date, plan_shift = all_shifts[shift_idx]

                    # 計画停止時間を取得
                    stop_time = stop_time_dict.get((plan_date, plan_shift, machine.id), 0)
                    overtime = OVERTIME_MAX[plan_shift]

                    # 型替え時間は不要（継続生産）
                    changeover_time = 0

                    current_mold_count = shift_count + i + 1

                    # 最後の直（6直目）の場合、型替え時間を設定
                    if current_mold_count >= MOLD_CHANGE_THRESHOLD:
                        changeover_time = CHANGEOVER_TIME

                    machine_plans[machine.id].append({
                        'date': plan_date,
                        'shift': plan_shift,
                        'item_name': current_item,
                        'overtime': overtime,
                        'stop_time': stop_time,
                        'changeover_time': changeover_time,
                        'mold_count': current_mold_count
                    })

                # 状態を更新
                machine_shift_count[machine.id] = shift_count + timing

                # 6直完了後は型数=0に設定
                if machine_shift_count[machine.id] >= MOLD_CHANGE_THRESHOLD:
                    machine_shift_count[machine.id] = 0

                # 【重要】次の型替えタイミングを更新
                # 前月から継続した設備は、既に計画を立てた分だけタイミングを進める
                next_changeover_timing[machine.id] = timing

        if not any(current_item and 0 < shift_count < MOLD_CHANGE_THRESHOLD and timing > 0
                   for machine in machines
                   for current_item, shift_count, timing in [(machine_current_item.get(machine.id),
                                                               machine_shift_count.get(machine.id, 0),
                                                               next_changeover_timing.get(machine.id, 0))]):
            log_file.write("  (前月から継続する設備なし)\n")
        log_file.write("\n")

        # 型替えイベント駆動メインループ
        iteration_count = 0
        MAX_ITERATIONS = len(all_shifts) * len(machines) * 2  # 無限ループ防止

        while processed_shift_idx < len(all_shifts) and iteration_count < MAX_ITERATIONS:
            iteration_count += 1

            # 最も早い型替えタイミングを見つける
            next_machine_id = None
            next_timing = float('inf')

            for machine in machines:
                timing = next_changeover_timing.get(machine.id, float('inf'))
                if timing < next_timing:
                    next_timing = timing
                    next_machine_id = machine.id

            # 全設備の型替えタイミングが計画期間外なら終了
            if next_timing >= len(all_shifts):
                break

            # 型替えタイミングまでの出荷・生産処理を実行
            for shift_idx in range(processed_shift_idx, next_timing):
                date, shift = all_shifts[shift_idx]

                # ログ: シフトのヘッダー
                log_file.write("\n" + "=" * 80 + "\n")
                log_file.write(f"【{date} {shift}直】（在庫・出荷処理のみ）\n")
                log_file.write("=" * 80 + "\n\n")

                # 出荷処理
                log_file.write("--- 出荷処理 ---\n")
                for item_name in sorted(all_item_names):
                    delivery = 0
                    for d in item_delivery.get(item_name, []):
                        if d['date'] == date and d['shift'] == shift:
                            delivery = d['count']
                            break

                    if delivery > 0:
                        before_stock = inventory.get(item_name, 0)
                        after_stock = before_stock - delivery
                        inventory[item_name] = after_stock
                        log_file.write(f"  {item_name}: {before_stock} → {after_stock} (出荷: {delivery}台)\n")
                log_file.write("\n")

                # 生産処理（既に決定済みの計画を実行）
                production_this_shift = {}
                for machine in machines:
                    plan_list = [p for p in machine_plans[machine.id]
                               if p['date'] == date and p['shift'] == shift]

                    if plan_list:
                        plan = plan_list[0]
                        item_name = plan['item_name']

                        key = f"{item_name}_{machine.id}"
                        data = item_data.get(key)

                        if data and data['tact'] > 0:
                            # 生産数を計算
                            changeover_time = plan.get('changeover_time', 0)
                            working_time = BASE_TIME[shift] - plan.get('stop_time', 0) - changeover_time + plan.get('overtime', 0)
                            if working_time < 0:
                                working_time = 0

                            production = math.floor((working_time / data['tact']) * occupancy_rate)
                            production_this_shift[item_name] = production_this_shift.get(item_name, 0) + production

                # 在庫を更新
                log_file.write("--- 生産処理 ---\n")
                for item_name in all_item_names:
                    production = production_this_shift.get(item_name, 0)
                    if production > 0:
                        # 良品率を考慮
                        yield_rate = 1.0
                        for key, data in item_data.items():
                            if data['name'] == item_name:
                                yield_rate = data['yield_rate']
                                break

                        good_production = math.floor(production * yield_rate)
                        before_stock = inventory.get(item_name, 0)
                        after_stock = before_stock + good_production
                        inventory[item_name] = after_stock
                        log_file.write(f"  {item_name}: {before_stock} → {after_stock} (生産: {good_production}台)\n")
                log_file.write("\n")

            processed_shift_idx = next_timing

            # 型替えタイミングに到達: 品番を決定して6直分の計画を立てる
            if next_timing < len(all_shifts):
                machine = next((m for m in machines if m.id == next_machine_id), None)
                if not machine:
                    break

                date, shift = all_shifts[next_timing]

                # ログ: 型替えイベント
                log_file.write("\n" + "=" * 80 + "\n")
                log_file.write(f"【{date} {shift}直】（設備#{machine.name} の型替えタイミング）\n")
                log_file.write("=" * 80 + "\n\n")

                # この設備で生産可能な品番リストを取得
                machine_items = []
                for key, data in item_data.items():
                    if data['machine_id'] == machine.id:
                        item_name = data['name']
                        if item_name not in machine_items:
                            machine_items.append(item_name)

                if not machine_items:
                    # 生産可能な品番がない場合は次の設備へ
                    next_changeover_timing[machine.id] = len(all_shifts)
                    continue

                # 現在このシフトで既に割り当てられた品番を確認
                assigned_items_count = {}
                for m in machines:
                    if m.id == machine.id:
                        continue  # 自分自身は除外
                    plan_list = [p for p in machine_plans[m.id]
                               if p['date'] == date and p['shift'] == shift]
                    if plan_list:
                        item = plan_list[0]['item_name']
                        assigned_items_count[item] = assigned_items_count.get(item, 0) + 1

                # 最も緊急度の高い品番を選択
                # 優先順位:
                # 1. 将来在庫がマイナスになる品番（最も早く在庫切れする順）
                # 2. 在庫切れがない場合は、月末在庫が最小の品番
                # 重要: 6直分すべての直で禁止パターンに違反しない品番のみを候補とする
                urgent_item = find_most_urgent_item(
                    machine_items, next_timing, machine.id, assigned_items_count, prohibited_patterns
                )

                if urgent_item:
                    # 現在の品番と連続直数を確認
                    current_item = machine_current_item.get(machine.id)
                    shift_count = machine_shift_count.get(machine.id, 0)

                    # 型数を設定
                    if current_item != urgent_item:
                        # 品番変更の場合
                        log_file.write(f"  品番変更: {current_item} → {urgent_item}\n")
                        log_file.write(f"  現在の型数: {shift_count}\n")
                        log_file.write(f"  detached_moldsの状態: {dict(detached_molds)}\n")

                        detached_current_mold = False
                        mold_count, _ = set_mold_count_for_item_change(
                            machine.id, current_item, urgent_item, shift_count, detached_molds, detached_current_mold
                        )

                        log_file.write(f"  割り当て後の型数: {mold_count}\n")
                    else:
                        # 同じ品番を継続する場合（6完了後の再開始）
                        mold_count = set_mold_count_for_continue(
                            machine.id, urgent_item, shift_count, detached_molds
                        )

                    log_file.write(f"--- 設備#{machine.name} に {urgent_item} を割り当て（型数={mold_count}） ---\n\n")

                    # 品番変更の場合、前の品番の最終直に型替え時間を設定
                    if current_item and current_item != urgent_item:
                        # 前の品番の最終直を取得
                        prev_plans = [p for p in machine_plans[machine.id]
                                    if p['item_name'] == current_item]
                        if prev_plans:
                            # 最後の計画に型替え時間を追加
                            prev_plans[-1]['changeover_time'] = CHANGEOVER_TIME

                    # 【重要】型数に応じた生産直数を計算
                    # 型数1の場合: 6直分生産（型数1→2→3→4→5→6）
                    # 型数2の場合: 5直分生産（型数2→3→4→5→6）
                    # 型数Nの場合: (6 - N + 1)直分生産
                    remaining_shifts_to_six = MOLD_CHANGE_THRESHOLD - mold_count + 1
                    max_shifts = min(remaining_shifts_to_six, len(all_shifts) - next_timing)

                    for i in range(max_shifts):
                        shift_idx = next_timing + i
                        if shift_idx >= len(all_shifts):
                            break

                        plan_date, plan_shift = all_shifts[shift_idx]

                        # 計画停止時間を取得
                        stop_time = stop_time_dict.get((plan_date, plan_shift, machine.id), 0)
                        overtime = OVERTIME_MAX[plan_shift]

                        current_mold_count = mold_count + i

                        # 型替え時間の判定：6直目のみ
                        changeover_time = 0
                        if current_mold_count >= MOLD_CHANGE_THRESHOLD:
                            changeover_time = CHANGEOVER_TIME

                        machine_plans[machine.id].append({
                            'date': plan_date,
                            'shift': plan_shift,
                            'item_name': urgent_item,
                            'overtime': overtime,
                            'stop_time': stop_time,
                            'changeover_time': changeover_time,
                            'mold_count': current_mold_count
                        })

                    # 設備の状態を更新
                    machine_current_item[machine.id] = urgent_item
                    machine_shift_count[machine.id] = mold_count + max_shifts - 1

                    # 6直完了後は型数=0に設定
                    if machine_shift_count[machine.id] >= MOLD_CHANGE_THRESHOLD:
                        machine_shift_count[machine.id] = 0

                    # 次の型替えタイミングを更新
                    next_changeover_timing[machine.id] = next_timing + max_shifts
                    log_file.write(f"  次の型替えタイミング: 直{next_timing} + {max_shifts}直 = 直{next_timing + max_shifts}\n")
                else:
                    # 品番を決定できなかった場合
                    next_changeover_timing[machine.id] = len(all_shifts)

        # 残りの直の在庫・出荷処理
        for shift_idx in range(processed_shift_idx, len(all_shifts)):
            date, shift = all_shifts[shift_idx]

            # ログ: シフトのヘッダー
            log_file.write("\n" + "=" * 80 + "\n")
            log_file.write(f"【{date} {shift}直】（残りの在庫・出荷処理）\n")
            log_file.write("=" * 80 + "\n\n")

            # 出荷処理
            log_file.write("--- 出荷処理 ---\n")
            for item_name in sorted(all_item_names):
                delivery = 0
                for d in item_delivery.get(item_name, []):
                    if d['date'] == date and d['shift'] == shift:
                        delivery = d['count']
                        break

                if delivery > 0:
                    before_stock = inventory.get(item_name, 0)
                    after_stock = before_stock - delivery
                    inventory[item_name] = after_stock
                    log_file.write(f"  {item_name}: {before_stock} → {after_stock} (出荷: {delivery}台)\n")
            log_file.write("\n")

            # 生産処理
            production_this_shift = {}
            for machine in machines:
                plan_list = [p for p in machine_plans[machine.id]
                           if p['date'] == date and p['shift'] == shift]

                if plan_list:
                    plan = plan_list[0]
                    item_name = plan['item_name']

                    key = f"{item_name}_{machine.id}"
                    data = item_data.get(key)

                    if data and data['tact'] > 0:
                        changeover_time = plan.get('changeover_time', 0)
                        working_time = BASE_TIME[shift] - plan.get('stop_time', 0) - changeover_time + plan.get('overtime', 0)
                        if working_time < 0:
                            working_time = 0

                        production = math.floor((working_time / data['tact']) * occupancy_rate)
                        production_this_shift[item_name] = production_this_shift.get(item_name, 0) + production

            # 在庫を更新
            log_file.write("--- 生産処理 ---\n")
            for item_name in all_item_names:
                production = production_this_shift.get(item_name, 0)
                if production > 0:
                    yield_rate = 1.0
                    for key, data in item_data.items():
                        if data['name'] == item_name:
                            yield_rate = data['yield_rate']
                            break

                    good_production = math.floor(production * yield_rate)
                    before_stock = inventory.get(item_name, 0)
                    after_stock = before_stock + good_production
                    inventory[item_name] = after_stock
                    log_file.write(f"  {item_name}: {before_stock} → {after_stock} (生産: {good_production}台)\n")
            log_file.write("\n")

            # ログ: 直後の在庫
            log_file.write("--- 直後の在庫 ---\n")
            for item_name in sorted(all_item_names):
                log_file.write(f"  {item_name}: {inventory.get(item_name, 0)} 台\n")
            log_file.write("\n")

            # ログ: 使いかけ金型の状態
            log_file.write("--- 使いかけ金型の状態 ---\n")
            if detached_molds:
                for item_name, mold_counts in detached_molds.items():
                    log_file.write(f"  {item_name}: {mold_counts}\n")
            else:
                log_file.write("  (なし)\n")
            log_file.write("\n")

        # ====================================================
        # 夜勤の残業チェック: 次の日勤と品番が異なる場合は残業禁止
        # ====================================================
        for i, (date, shift) in enumerate(all_shifts):
            if shift == 'night':
                # 次の直（日勤）があるかチェック
                if i + 1 < len(all_shifts):
                    next_date, next_shift = all_shifts[i + 1]

                    # 次の直が日勤であることを確認（夜勤の次は通常日勤）
                    if next_shift != 'day':
                        continue

                    # 各設備について夜勤と次の日勤の品番を比較
                    for machine in machines:
                        night_plans = [p for p in machine_plans[machine.id]
                                     if p['date'] == date and p['shift'] == 'night']
                        day_plans = [p for p in machine_plans[machine.id]
                                   if p['date'] == next_date and p['shift'] == next_shift]

                        if night_plans and day_plans:
                            night_item = night_plans[0]['item_name']
                            day_item = day_plans[0]['item_name']
                            night_changeover = night_plans[0].get('changeover_time', 0)
                            night_mold_count = night_plans[0].get('mold_count', 0)

                            # 品番が異なる場合は夜勤で型替え
                            if night_item != day_item:
                                # 夜勤で既に型替え時間が設定されている場合（6直目）は追加不要
                                if night_changeover == 0:
                                    # 型替え時間を設定（夜勤で型替えが発生）
                                    night_plans[0]['changeover_time'] = CHANGEOVER_TIME

                                # 夜勤で型替えするため、残業禁止
                                night_plans[0]['overtime'] = 0

                                # 次の日勤の型替え時間はクリア（夜勤で型替え済み）
                                if day_plans[0].get('changeover_time', 0) > 0:
                                    day_plans[0]['changeover_time'] = 0


            for i, (date, shift) in enumerate(all_shifts):
                if shift != 'day':
                    continue  # 日勤のみ処理

                # 同じ日の夜勤を取得
                night_shift_idx = i + 1
                if night_shift_idx >= len(all_shifts):
                    continue

                next_date, next_shift = all_shifts[night_shift_idx]

                # 次の直が夜勤で、同じ日付であることを確認
                if next_shift != 'night' or next_date != date:
                    continue

                # 各設備について日勤と夜勤の品番を比較
                for machine in machines:
                    day_plans = [p for p in machine_plans[machine.id]
                               if p['date'] == date and p['shift'] == 'day']
                    night_plans = [p for p in machine_plans[machine.id]
                                 if p['date'] == next_date and p['shift'] == next_shift]

                    if day_plans and night_plans:
                        day_item = day_plans[0]['item_name']
                        night_item = night_plans[0]['item_name']
                        day_changeover = day_plans[0].get('changeover_time', 0)

                        # 品番が異なる場合は日勤で型替え
                        if (day_item != night_item) and (day_changeover == 0):
                            # 日勤で既に型替え時間が設定されている場合（6直目）は追加不要
                            if day_changeover == 0:
                                # 型替え時間を設定（日勤で型替えが発生）
                                day_plans[0]['changeover_time'] = CHANGEOVER_TIME

        # 結果をフォーマット
        result = []

        # デバッグ: 10/6 day直のmold_countを確認
        for machine in machines:
            oct6_day_plans = [p for p in machine_plans[machine.id]
                            if p['date'].isoformat() == '2025-10-06' and p['shift'] == 'day']
            if oct6_day_plans:
                plan = oct6_day_plans[0]

        for machine in machines:
            for plan in machine_plans[machine.id]:
                mold_count = plan.get('mold_count', 0)
                changeover_time = plan.get('changeover_time', 0)
                result.append({
                    'machine_id': machine.id,
                    'machine_name': machine.name,
                    'date': plan['date'].isoformat(),
                    'shift': plan['shift'],
                    'item_name': plan['item_name'],
                    'overtime': plan['overtime'],
                    'mold_count': mold_count,  # 使用回数を追加
                    'changeover_time': changeover_time  # 型替え時間を追加
                })

        # ログファイルを閉じる
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("計画完了\n")
        log_file.write("=" * 80 + "\n")
        log_file.close()

        # 使用されなかった金型データを変換（翌月引き継ぎ用）
        unused_molds_data = []
        for item_name, used_counts in detached_molds.items():
            # 各金型（同一品番でも複数ある可能性）について
            for used_count in used_counts:
                # 品番に対応する全設備を取得
                item_machines = []
                for machine in machines:
                    # この品番がこの設備で作れるかチェック
                    key = f"{item_name}_{machine.id}"
                    if key in item_data:
                        item_machines.append(machine)

                # 最初の設備を代表として記録（実際には全設備で共有）
                if item_machines:
                    unused_molds_data.append({
                        'machine_id': item_machines[0].id,
                        'machine_name': item_machines[0].name,
                        'item_name': item_name,
                        'used_count': used_count,
                        'end_of_month': False  # 月末に設置されていない（途中で外された）
                    })

        return {
            'plans': result,
            'unused_molds': unused_molds_data
        }

