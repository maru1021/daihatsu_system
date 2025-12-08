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
from datetime import datetime, date, timedelta
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

            # 稼働率の処理: 1より大きければ%表記（93 = 93%）として100で割る
            if line.occupancy_rate:
                occupancy_rate = line.occupancy_rate / 100.0 if line.occupancy_rate > 1.0 else line.occupancy_rate
            else:
                occupancy_rate = 1.0

            # ライン名に応じて適切な自動生成メソッドを選択
            if line.name == 'カバー':
                # カバーライン: 前月末の各設備の生産品番を取得
                prev_machine_items = {}
                if start_date.day == 1:
                    # 前月の最終日を取得
                    prev_month_last_date = start_date - timedelta(days=1)

                    # 前月末の生産計画を取得
                    prev_month_plans = DailyMachineCastingProductionPlan.objects.filter(
                        machine__line=line,
                        date=prev_month_last_date,
                        shift='night'  # 前月の最終直（夜勤）
                    ).select_related('machine', 'production_item')

                    for plan in prev_month_plans:
                        if plan.production_item:
                            prev_machine_items[plan.machine.id] = plan.production_item.name

                    # 夜勤の計画がない場合は、前月最終日の日勤を確認
                    if not prev_machine_items:
                        prev_month_plans = DailyMachineCastingProductionPlan.objects.filter(
                            machine__line=line,
                            date=prev_month_last_date,
                            shift='day'
                        ).select_related('machine', 'production_item')

                        for plan in prev_month_plans:
                            if plan.production_item:
                                prev_machine_items[plan.machine.id] = plan.production_item.name

                # カバーライン用の自動生成（金型管理なし、在庫0-1000管理）
                result = self._generate_auto_plan_cover(
                    working_days=working_days,
                    machines=machines,
                    item_delivery=item_delivery,
                    prev_inventory=prev_inventory,
                    optimal_inventory=optimal_inventory,
                    item_data=item_data,
                    stop_time_data=stop_time_data,
                    line=line,
                    occupancy_rate=occupancy_rate,
                    prev_machine_items=prev_machine_items
                )
            else:
                # ヘッドライン用の自動生成（既存アルゴリズム）
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
                    occupancy_rate=occupancy_rate
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

    def _generate_auto_plan_cover(self, working_days, machines, item_delivery, prev_inventory,
                                  optimal_inventory, item_data, stop_time_data, line, occupancy_rate,
                                  prev_machine_items=None):
        """
        カバーライン用の自動生産計画を生成

        【カバーラインの特徴】
        - 金型管理なし（6直制約なし）
        - 型替え可能品番の概念なし
        - 在庫数が0になる前の直までにできる限り生産
        - 各品番の在庫数が1000個を超えないように残業時間を調整
        - 同一品番でも設備が異なればタクトが違う
        - 型替え最小化：前の直と同じ品番を継続する場合を優先
        - タクト最適化：複数の設備候補がある場合、最もタクトが速い設備を選択(前の直で同じ品案のものがある場合は除外)
        - 型替えの時間は品番が変わる前側のところで発生
        - 型替え時間を考慮して生産数を計算

        【絶対制約】
        - 在庫数を0にしない
        - 在庫数を1000以上にしない
        - #1,#2は作成できる品番が同じなので無駄な型替えをしない

        Args:
            working_days (list): 稼働日リスト
            machines (list): 設備リスト
            item_delivery (dict): 出庫計画 {品番: [{'date': date, 'shift': str, 'count': int}]}
            prev_inventory (dict): 前月末在庫 {品番: 個数}
            optimal_inventory (dict): 適正在庫 {品番: 個数}
            item_data (dict): 品番-設備マスタデータ {key: {'name': str, 'tact': float, 'yield_rate': float, 'machine_id': int}}
            stop_time_data (list): 計画停止データ [{'date': date, 'shift': str, 'machine_id': int, 'stop_time': int}]
            line: 鋳造ライン
            occupancy_rate (float): 稼働率
            prev_machine_items (dict): 前月末の各設備の生産品番 {machine_id: item_name}

        Returns:
            dict: {
                'plans': [plan_dict, ...],
                'unused_molds': []
            }
        """
        if prev_machine_items is None:
            prev_machine_items = {}
        import os
        from datetime import datetime
        import math

        # ========================================
        # 定数定義
        # ========================================
        BASE_TIME = {'day': 455, 'night': 450}  # 基本稼働時間（分）
        OVERTIME_MAX = {'day': 120, 'night': 60}  # 残業上限（分）
        MIN_STOCK = 0  # 最小在庫（絶対に下回らないようにする）
        MAX_STOCK = 1000  # 最大在庫（絶対に上回らないようにする）
        SAFETY_THRESHOLD = 50  # 安全在庫レベル（この値以下は危険）
        CHANGEOVER_TARGET = 900  # 型替え推奨在庫レベル（この値に近づけると型替え効率最大）
        CHANGEOVER_READY_STOCK = 900  # 型替え可能在庫レベル（この値以上で型替え検討）
        URGENCY_THRESHOLD = 3  # 緊急度閾値（在庫切れまでの直数がこの値以下なら必ず生産）
        CHANGEOVER_TIME = line.changeover_time or 30  # 型替え時間（分）

        # ログファイルの設定
        log_dir = os.path.dirname(os.path.abspath(__file__))
        log_file_path = os.path.join(log_dir, 'inventory_simulation_log_cover.txt')

        # 既存のログファイルを削除
        if os.path.exists(log_file_path):
            os.remove(log_file_path)

        # ログファイルを開く
        log_file = open(log_file_path, 'w', encoding='utf-8')
        log_file.write("=" * 80 + "\n")
        log_file.write("カバーライン 鋳造生産計画 在庫シミュレーションログ\n")
        log_file.write(f"生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        log_file.write("=" * 80 + "\n\n")

        # 全シフトのリスト（日付×シフト）
        all_shifts = []
        for date in working_days:
            all_shifts.append((date, 'day'))
            # 土日（weekday: 5=土曜, 6=日曜）は夜勤なし
            if date.weekday() < 5:
                all_shifts.append((date, 'night'))

        # 計画停止データを辞書化
        stop_time_dict = {}
        for stop in stop_time_data:
            key = (stop['date'], stop['shift'], stop['machine_id'])
            stop_time_dict[key] = stop['stop_time']

        # 品番リストを作成
        all_item_names = set()
        for key, data in item_data.items():
            all_item_names.add(data['name'])

        # 在庫シミュレーション用の変数を初期化(前月最終直の在庫)
        inventory = {item: prev_inventory.get(item, 0) for item in all_item_names}

        # 各鋳造機の生産計画
        machine_plans = {m.id: [] for m in machines}

        # 各鋳造機の現在の品番（品番変更時の型替え時間判定用）
        # 前月末の品番を初期値として設定
        machine_current_item = {m.id: prev_machine_items.get(m.id) for m in machines}

        # 型替え回数の統計
        total_changeovers = 0

        # ========================================
        # ヘルパー関数定義
        # ========================================

        def calculate_production(item_name, machine_id, shift, stop_time=0, overtime=0, changeover_time=0):
            """指定した品番・設備での生産数を計算

            Args:
                item_name: 品番
                machine_id: 設備ID
                shift: シフト（'day' or 'night'）
                stop_time: 計画停止時間（分）
                overtime: 残業時間（分）
                changeover_time: 型替え時間（分）

            Returns:
                tuple: (総生産数, 良品数)
            """
            key = f"{item_name}_{machine_id}"
            data = item_data.get(key)

            if not data or data['tact'] == 0:
                return 0, 0  # (総生産数, 良品数)

            working_time = BASE_TIME[shift] - stop_time - changeover_time + overtime
            if working_time < 0:
                working_time = 0

            # 総生産数（不良品も含む）
            total_production = math.floor((working_time / data['tact']) * occupancy_rate)
            # 良品数
            good_production = math.floor(total_production * data['yield_rate'])

            return total_production, good_production

        def calculate_shifts_until_stockout(item_name, current_shift_idx, initial_stock=None):
            """品番の在庫が0になるまでの残り直数を計算

            将来の出荷予定を考慮して、在庫が0以下になるまでの直数を計算する。

            Args:
                item_name: 品番
                current_shift_idx: 開始直のインデックス
                initial_stock: 初期在庫（Noneの場合は現在の在庫を使用）

            Returns:
                int or float: 在庫切れまでの直数（月末まで在庫切れしない場合はfloat('inf')）
            """
            if initial_stock is None:
                simulated_inv = inventory.get(item_name, 0)
            else:
                simulated_inv = initial_stock

            for idx in range(current_shift_idx, len(all_shifts)):
                sim_date, sim_shift = all_shifts[idx]

                # この直での出庫数
                delivery = 0
                for d in item_delivery.get(item_name, []):
                    if d['date'] == sim_date and d['shift'] == sim_shift:
                        delivery = d['count']
                        break

                # 出庫
                simulated_inv -= delivery

                # 在庫が0以下になる場合、残り直数を返す
                if simulated_inv <= 0:
                    return idx - current_shift_idx

            # 月末まで在庫切れしない場合、大きい値を返す
            return float('inf')

        def find_most_urgent_item_for_machine(machine_id, current_shift_idx):
            """この設備で最も緊急度の高い品番を見つける"""
            # この設備で生産可能な品番リストを取得
            machine_items = []
            for key, data in item_data.items():
                if data['machine_id'] == machine_id:
                    item_name = data['name']
                    if item_name not in machine_items:
                        machine_items.append(item_name)

            if not machine_items:
                return None

            # 各品番の緊急度を計算
            urgency_list = []
            for item_name in machine_items:
                shifts_until_stockout = calculate_shifts_until_stockout(item_name, current_shift_idx)
                current_stock = inventory.get(item_name, 0)
                urgency_list.append((item_name, shifts_until_stockout, current_stock))

            # 緊急度順にソート（在庫切れまでの直数が少ない順、同じなら在庫が少ない順）
            urgency_list.sort(key=lambda x: (x[1], x[2]))

            # 最も緊急度の高い品番を返す
            return urgency_list[0][0]

        def calculate_optimal_overtime(item_name, machine_id, shift, stop_time, changeover_time, current_shift_planned_production, delivery_this_shift=0, is_continuation=False):
            """在庫が0にならず、かつMAX_STOCK（1000）を超えないように最適な残業時間を計算

            在庫制約を遵守しつつ、継続生産の場合は在庫を900台に近づけることで
            型替え効率を最大化する。

            Args:
                item_name: 品番
                machine_id: 設備ID
                shift: シフト（'day' or 'night'）
                stop_time: 計画停止時間（分）
                changeover_time: 型替え時間（分）
                current_shift_planned_production: この直で既に計画された生産数（他の設備分）
                delivery_this_shift: この直での出荷数
                is_continuation: 継続生産かどうか

            Returns:
                int: 最適な残業時間（分、5分刻み）
            """
            current_stock = inventory.get(item_name, 0) + current_shift_planned_production

            # この直の出荷後の在庫を予測
            stock_after_delivery = current_stock - delivery_this_shift

            # 残業なしの場合の生産数を計算
            _, good_production_no_overtime = calculate_production(
                item_name, machine_id, shift, stop_time, 0, changeover_time
            )

            # 最大残業時間での生産数を計算
            _, good_production_max_overtime = calculate_production(
                item_name, machine_id, shift, stop_time, OVERTIME_MAX[shift], changeover_time
            )

            # ケース1: 出荷後の在庫が危険レベル以下になる場合、必要な生産数を計算
            if stock_after_delivery + good_production_no_overtime < SAFETY_THRESHOLD:
                # 安全在庫を確保するために必要な生産数
                required_production = SAFETY_THRESHOLD - stock_after_delivery

                # 必要な残業時間を計算
                min_overtime = 0
                achieved_safety = False
                for overtime in range(0, OVERTIME_MAX[shift] + 1, 5):
                    _, good_production = calculate_production(
                        item_name, machine_id, shift, stop_time, overtime, changeover_time
                    )

                    # 必要な生産数を達成できる場合
                    if stock_after_delivery + good_production >= SAFETY_THRESHOLD:
                        min_overtime = overtime
                        achieved_safety = True
                        break

                # 最大残業でも安全在庫を確保できない場合、警告ログ
                if not achieved_safety:
                    _, max_production = calculate_production(
                        item_name, machine_id, shift, stop_time, OVERTIME_MAX[shift], changeover_time
                    )
                    final_stock = stock_after_delivery + max_production
                    if final_stock < SAFETY_THRESHOLD:
                        log_file.write(f"\n    【警告】{item_name}: 最大残業でも安全在庫({SAFETY_THRESHOLD}台)を確保できません！ "
                                     f"予測在庫:{final_stock}台\n")
                    min_overtime = OVERTIME_MAX[shift]

                # 在庫上限チェック
                for overtime in range(min_overtime, OVERTIME_MAX[shift] + 1, 5):
                    _, good_production = calculate_production(
                        item_name, machine_id, shift, stop_time, overtime, changeover_time
                    )

                    # 在庫が1000を超えない最大の残業時間を返す
                    if stock_after_delivery + good_production <= MAX_STOCK:
                        min_overtime = overtime
                    else:
                        break

                return min_overtime

            # ケース2: 継続生産の場合、型替え推奨在庫（900台）に近づけるように最大残業
            # 型替え時に在庫が十分にあれば、その後しばらく生産しなくて良い
            if is_continuation and changeover_time == 0:
                # 継続生産中（型替えなし）の場合、在庫を900台に近づける
                if stock_after_delivery < CHANGEOVER_TARGET:
                    # 900台に近づくまで最大残業で生産
                    if stock_after_delivery + good_production_max_overtime <= MAX_STOCK:
                        return OVERTIME_MAX[shift]

                    # 1000を超えない範囲で最大化
                    optimal_overtime = 0
                    for overtime in range(0, OVERTIME_MAX[shift] + 1, 5):
                        _, good_production = calculate_production(
                            item_name, machine_id, shift, stop_time, overtime, changeover_time
                        )

                        if stock_after_delivery + good_production <= MAX_STOCK:
                            optimal_overtime = overtime
                        else:
                            break

                    return optimal_overtime

            # ケース3: 在庫は十分だが、1000を超えないように調整
            # 残業なしで1000を超えない場合、最大残業時間を使用
            if stock_after_delivery + good_production_no_overtime <= MAX_STOCK:
                # 最大残業でも1000を超えない場合、最大残業時間を返す
                if stock_after_delivery + good_production_max_overtime <= MAX_STOCK:
                    return OVERTIME_MAX[shift]

            # 在庫が1000を超えないように残業時間を調整（5分刻み）
            optimal_overtime = 0

            for overtime in range(0, OVERTIME_MAX[shift] + 1, 5):
                _, good_production = calculate_production(
                    item_name, machine_id, shift, stop_time, overtime, changeover_time
                )

                if stock_after_delivery + good_production <= MAX_STOCK:
                    optimal_overtime = overtime
                else:
                    break

            return optimal_overtime

        # ========================================
        # メインループ: 各直で生産計画を立てる
        # ========================================

        # デバッグ: 設備と品番のマッピングを確認
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【設備と品番のマッピング確認】\n")
        log_file.write("=" * 80 + "\n\n")
        log_file.write(f"稼働率: {occupancy_rate}\n\n")
        for machine in machines:
            log_file.write(f"設備#{machine.name} (ID:{machine.id}):\n")
            machine_items = []
            for key, data in item_data.items():
                if data['machine_id'] == machine.id:
                    item_name = data['name']
                    if item_name not in machine_items:
                        machine_items.append(item_name)
                        log_file.write(f"  - {item_name} (タクト:{data['tact']}秒, 良品率:{data['yield_rate']})\n")
            if not machine_items:
                log_file.write(f"  ※生産可能な品番なし\n")
            log_file.write("\n")

        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【初期在庫】\n")
        log_file.write("=" * 80 + "\n\n")
        for item_name in sorted(all_item_names):
            log_file.write(f"  {item_name}: {inventory.get(item_name, 0)} 台\n")
        log_file.write("\n")

        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【前月末の各設備の生産品番】\n")
        log_file.write("=" * 80 + "\n\n")
        if prev_machine_items:
            for machine in machines:
                prev_item = prev_machine_items.get(machine.id)
                if prev_item:
                    log_file.write(f"  設備#{machine.name}: {prev_item}\n")
                else:
                    log_file.write(f"  設備#{machine.name}: データなし\n")
        else:
            log_file.write("  前月末のデータなし\n")
        log_file.write("\n")


        for shift_idx, (date, shift) in enumerate(all_shifts):
            log_file.write("\n" + "=" * 80 + "\n")
            log_file.write(f"【{date} {shift}直】\n")
            log_file.write("=" * 80 + "\n\n")

            # この直の出荷予定を事前に取得（実際の出荷処理は後で行う）
            shift_deliveries = {}
            for item_name in all_item_names:
                delivery = 0
                for d in item_delivery.get(item_name, []):
                    if d['date'] == date and d['shift'] == shift:
                        delivery = d['count']
                        break
                shift_deliveries[item_name] = delivery

            # ステップ1: 全設備の品番を決定する（出荷前の在庫で評価）
            log_file.write("--- 生産計画（品番選択） ---\n")
            shift_plans = []  # この直の全設備の計画を一時保存
            planned_production_by_item = defaultdict(int)  # 品番ごとの計画生産数（良品）
            assigned_machines = set()  # 既に割り当て済みの設備

            def evaluate_item_urgency():
                """全品番の緊急度を評価してソート

                在庫マイナス品番を最優先とし、継続生産可能品番を優先することで
                型替え回数を削減する。

                ソート順序:
                1. 在庫マイナスフラグ（マイナスが最優先）
                2. 継続生産可否（継続可能を優先）
                3. 出荷後在庫（マイナスが深刻な順）
                4. 生産可能設備数（少ない方を優先、設備制約考慮）
                5. 在庫切れまでの直数（少ない方が緊急）

                Returns:
                    list: 緊急度情報を含む品番リスト（ソート済み）
                        各要素: {
                            'item_name': 品番名,
                            'shifts_until_stockout': 在庫切れまでの直数,
                            'current_stock': 現在在庫,
                            'stock_after_delivery': 出荷後在庫,
                            'delivery_this_shift': この直での出荷数,
                            'can_continue': 継続生産可能か,
                            'is_critical': 緊急品番か,
                            'available_machine_count': 生産可能設備数
                        }
                """
                urgency_list = []

                # 各品番の緊急度を計算
                for item_name in all_item_names:
                    current_stock = inventory.get(item_name, 0)
                    delivery_this_shift = shift_deliveries.get(item_name, 0)
                    stock_after_delivery = current_stock - delivery_this_shift

                    # 在庫切れまでの直数を計算
                    if stock_after_delivery < 0:
                        shifts_until_stockout = 0
                    else:
                        shifts_until_stockout = calculate_shifts_until_stockout(
                            item_name, shift_idx + 1, initial_stock=stock_after_delivery
                        )

                    # 継続生産可能かチェック（全設備で確認）
                    can_continue = any(
                        machine_current_item.get(m.id) == item_name
                        for m in machines
                    )

                    # この品番を生産可能な設備数をカウント（未割り当ての設備のみ）
                    available_machine_count = 0
                    for m in machines:
                        if m.id not in assigned_machines:
                            key = f"{item_name}_{m.id}"
                            if key in item_data:
                                available_machine_count += 1

                    urgency_list.append({
                        'item_name': item_name,
                        'shifts_until_stockout': shifts_until_stockout,
                        'current_stock': current_stock,
                        'stock_after_delivery': stock_after_delivery,
                        'delivery_this_shift': delivery_this_shift,
                        'can_continue': can_continue,
                        'is_critical': stock_after_delivery < 0 or shifts_until_stockout <= 1,
                        'available_machine_count': available_machine_count
                    })

                # ソート: 在庫マイナスフラグ → 継続生産可否 → 出荷後在庫 → 生産可能設備数 → 緊急度
                # 1. 在庫がマイナスになる品番を最優先
                # 2. 継続生産可能な品番を優先（型替え削減、設備の継続確保）
                # 3. マイナスが深刻な順（-423 < -317 < 25）
                urgency_list.sort(key=lambda x: (
                    0 if x['stock_after_delivery'] < 0 else 1,  # マイナスが最優先
                    0 if x['can_continue'] else 1,  # 継続生産可能を優先（型替え削減）
                    x['stock_after_delivery'],  # マイナスが深刻な順
                    x['available_machine_count'],  # 設備制約のある品番を優先
                    x['shifts_until_stockout']  # 緊急度
                ))

                return urgency_list

            def find_machine_for_item(item_name):
                """品番に最適な設備を探す（設備グループ考慮）

                設備グループ:
                - グループA: 650t#1, 650t#2（グループ内で入れ替え可能）
                - グループB: 800t#3（独立）

                優先順位:
                1. 同じ設備で継続生産（型替えなし）
                2. 同じグループ内の別の設備で継続生産（グループA内の#1↔#2入れ替え）
                3. タクトが最も速い設備

                Args:
                    item_name: 品番名

                Returns:
                    tuple: (machine, is_continuation)
                        - machine: 割り当てる設備（見つからない場合はNone）
                        - is_continuation: 継続生産かどうか（True/False）
                """
                # 設備グループの定義
                GROUP_A = ['650t#1', '650t#2']  # グループ内で入れ替え可能
                GROUP_B = ['800t#3']  # 独立

                # この品番の現在の在庫をチェック
                current_stock = inventory.get(item_name, 0)
                delivery_this_shift = shift_deliveries.get(item_name, 0)
                stock_after_delivery = current_stock - delivery_this_shift
                shifts_until_stockout = calculate_shifts_until_stockout(
                    item_name, shift_idx + 1, initial_stock=stock_after_delivery
                ) if stock_after_delivery >= 0 else 0

                # 在庫が900台以上で緊急度が低い場合は型替えを推奨
                should_changeover = (current_stock >= CHANGEOVER_READY_STOCK and
                                   shifts_until_stockout > URGENCY_THRESHOLD)

                # 1. 同じ設備で継続生産可能かチェック
                for machine in machines:
                    if machine.id in assigned_machines:
                        continue
                    if machine_current_item.get(machine.id) == item_name:
                        key = f"{item_name}_{machine.id}"
                        if key in item_data:
                            if should_changeover:
                                log_file.write(f"      【型替え推奨】{item_name}の在庫が{current_stock}台で十分→他の品番を優先\n")
                                break
                            return machine, True  # 同じ設備で継続生産

                # 2. 同じグループ内の別の設備で継続生産可能かチェック
                if not should_changeover:
                    # 前の直でこの品番を生産していた設備を探す
                    prev_machine_name = None
                    for machine in machines:
                        if machine_current_item.get(machine.id) == item_name:
                            prev_machine_name = machine.name
                            break

                    if prev_machine_name:
                        # 前の設備が属していたグループを特定
                        prev_group = GROUP_A if prev_machine_name in GROUP_A else (GROUP_B if prev_machine_name in GROUP_B else None)

                        if prev_group:
                            # 同じグループ内の未割り当て設備を探す
                            for machine in machines:
                                if machine.id in assigned_machines:
                                    continue
                                if machine.name in prev_group:
                                    key = f"{item_name}_{machine.id}"
                                    if key in item_data:
                                        log_file.write(f"      【グループ内継続】{item_name}を{prev_machine_name}→#{machine.name}に移動（継続生産）\n")
                                        return machine, True  # グループ内で継続生産

                # 3. 継続生産できない場合、未割り当ての設備から最速タクトを選択
                available_machines = []
                for machine in machines:
                    if machine.id in assigned_machines:
                        continue
                    key = f"{item_name}_{machine.id}"
                    if key in item_data:
                        available_machines.append(machine)

                if not available_machines:
                    return None, False

                # タクトが最も小さい（速い）設備を選択
                best_machine = min(available_machines, key=lambda m: item_data[f"{item_name}_{m.id}"]['tact'])
                return best_machine, False

            # 全品番の緊急度を評価
            item_urgency = evaluate_item_urgency()

            log_file.write(f"  品番緊急度評価（出荷前）:\n")
            for item_info in item_urgency:
                continue_mark = "【継続可】" if item_info['can_continue'] else ""
                machine_count_info = f"[設備:{item_info['available_machine_count']}台で生産可]"
                if item_info['delivery_this_shift'] > 0:
                    log_file.write(f"    {item_info['item_name']}{continue_mark}{machine_count_info}: "
                                 f"現在{item_info['current_stock']}台 - 出荷{item_info['delivery_this_shift']}台 = "
                                 f"出荷後{item_info['stock_after_delivery']}台, "
                                 f"在庫切れまで{item_info['shifts_until_stockout']}直\n")
                else:
                    log_file.write(f"    {item_info['item_name']}{continue_mark}{machine_count_info}: "
                                 f"現在{item_info['current_stock']}台（出荷なし）, "
                                 f"在庫切れまで{item_info['shifts_until_stockout']}直\n")
            log_file.write("\n")

            # ========================================
            # 2フェーズ品番割り当てアルゴリズム
            # ========================================
            # フェーズ1: 在庫マイナス品番を絶対優先で処理
            #   - 在庫がマイナスになる品番は継続生産より優先
            #   - 設備制約も考慮し、生産可能設備数が少ない品番を優先
            #   - 同一品番の重複生産を防止（1品番=1設備の原則）
            #
            # フェーズ2: その他の品番を緊急度順に処理
            #   - 緊急度（在庫切れまでの直数）を考慮
            #   - 設備制約のある品番を優先
            #   - 継続生産可能な品番を優先（型替え削減）
            #   - グループ内で柔軟に設備を入れ替えて継続生産を実現
            # ========================================
            log_file.write("  【2フェーズ品番割り当て（設備グループ考慮）】\n")

            # フェーズ1: 在庫マイナス品番のみ処理
            log_file.write("\n  --- フェーズ1: 在庫マイナス品番 ---\n")
            for item_info in item_urgency:
                # 在庫マイナス品番のみ処理
                if item_info['stock_after_delivery'] >= 0:
                    continue

                item_name = item_info['item_name']

                # 既にこの品番が別の設備に割り当てられているかチェック
                already_assigned = any(plan['item_name'] == item_name for plan in shift_plans)
                if already_assigned:
                    log_file.write(f"\n    品番:{item_name} → スキップ: この品番は既に別の設備で生産計画済み\n")
                    continue

                # 全設備が割り当て済みなら終了
                if len(assigned_machines) >= len(machines):
                    break

                # デバッグ: 前の直の設備状態を確認
                log_file.write(f"\n    品番:{item_name} (出荷後在庫:{item_info['stock_after_delivery']}台, "
                             f"生産可能設備:{item_info['available_machine_count']}台)\n")
                log_file.write(f"      前の直の設備状態: ")
                for m in machines:
                    prev = machine_current_item.get(m.id, "未設定")
                    assigned = "割当済" if m.id in assigned_machines else "未割当"
                    log_file.write(f"#{m.name}:{prev}({assigned}), ")
                log_file.write(f"\n")

                # 品番に最適な設備を探す
                machine, is_continuation = find_machine_for_item(item_name)

                if machine is None:
                    log_file.write(f"      → 【警告】在庫マイナス品番なのに設備が見つかりません！\n")
                    continue

                # ログ出力
                log_file.write(f"      → 生産決定: 在庫マイナス（最優先）\n")
                if is_continuation:
                    log_file.write(f"      → 設備#{machine.name}で継続生産（型替えなし）\n")
                else:
                    # 継続生産できなかった理由をログ
                    continuation_failed_reason = ""
                    for m in machines:
                        if machine_current_item.get(m.id) == item_name:
                            if m.id in assigned_machines:
                                continuation_failed_reason = f"（注：前の直の設備#{m.name}は既に別の品番に割当済み）"
                            break
                    log_file.write(f"      → 設備#{machine.name}を選択（最速タクト）{continuation_failed_reason}\n")

                # 計画停止時間を取得
                stop_time = stop_time_dict.get((date, shift, machine.id), 0)

                # 前の直と品番が異なる場合、前の直に型替え時間を設定
                prev_item = machine_current_item.get(machine.id)
                this_shift_changeover_time = 0

                if prev_item and prev_item != item_name:
                    # 品番が変わる場合、前の直の最後の計画に型替え時間を追加
                    if machine_plans[machine.id]:
                        prev_plan = machine_plans[machine.id][-1]
                        old_changeover = prev_plan['changeover_time']

                        # 型替え時間をまだ設定していない場合のみ追加
                        if old_changeover == 0:
                            prev_plan['changeover_time'] = CHANGEOVER_TIME

                            # 前の直の生産数を再計算（型替え時間を考慮）
                            prev_key = f"{prev_item}_{machine.id}"
                            prev_data = item_data.get(prev_key)
                            if prev_data:
                                # 古い生産数を取得
                                old_working_time = BASE_TIME[prev_plan['shift']] - prev_plan['stop_time'] - old_changeover + prev_plan['overtime']
                                old_total_prod = math.floor((old_working_time / prev_data['tact']) * occupancy_rate)
                                old_good_prod = math.floor(old_total_prod * prev_data['yield_rate'])

                                # 新しい生産数を計算（型替え時間を引く）
                                new_working_time = BASE_TIME[prev_plan['shift']] - prev_plan['stop_time'] - CHANGEOVER_TIME + prev_plan['overtime']
                                if new_working_time < 0:
                                    new_working_time = 0
                                new_total_prod = math.floor((new_working_time / prev_data['tact']) * occupancy_rate)
                                new_good_prod = math.floor(new_total_prod * prev_data['yield_rate'])

                                # 在庫の差分を修正
                                production_diff = new_good_prod - old_good_prod
                                inventory[prev_item] += production_diff

                                # 前の直の在庫情報を更新
                                prev_plan['after_stock'] = inventory.get(prev_item, 0)

                                log_file.write(f"      【型替え時間設定】前の直（設備#{machine.name}, {prev_item}）に型替え時間{CHANGEOVER_TIME}分を追加\n")
                                log_file.write(f"        前の直の生産数: {old_good_prod}台 → {new_good_prod}台（差分: {production_diff}台）\n")
                                log_file.write(f"        {prev_item}の在庫修正: {inventory.get(prev_item, 0) - production_diff}台 → {inventory.get(prev_item, 0)}台\n")

                            # 型替え回数をカウント
                            total_changeovers += 1

                    # 現在の直では型替え時間なし（前の直で設定済み）
                    this_shift_changeover_time = 0

                elif prev_item is None:
                    # 前月末のデータがない場合は型替え時間を設定
                    this_shift_changeover_time = CHANGEOVER_TIME

                # この直で既に計画されたこの品番の生産数を取得
                current_shift_planned = planned_production_by_item.get(item_name, 0)

                # この直での出荷数を取得
                delivery = shift_deliveries.get(item_name, 0)

                # 最適な残業時間を計算（在庫が0にならず、かつ1000を超えないように）
                # 継続生産の場合は、在庫を900台に近づけるように最大残業
                optimal_overtime = calculate_optimal_overtime(
                    item_name, machine.id, shift, stop_time, this_shift_changeover_time,
                    current_shift_planned, delivery, is_continuation
                )

                # 生産数を計算
                total_prod, good_prod = calculate_production(
                    item_name, machine.id, shift, stop_time, optimal_overtime, this_shift_changeover_time
                )

                # この直の計画を一時保存
                shift_plans.append({
                    'machine': machine,
                    'item_name': item_name,
                    'overtime': optimal_overtime,
                    'stop_time': stop_time,
                    'changeover_time': this_shift_changeover_time,
                    'total_production': total_prod,
                    'good_production': good_prod
                })

                # 計画生産数を記録
                planned_production_by_item[item_name] += good_prod

                # 設備を割り当て済みとしてマーク
                assigned_machines.add(machine.id)

                # タクト情報を取得
                key = f"{item_name}_{machine.id}"
                tact_info = item_data[key]['tact']

                log_file.write(f"  設備#{machine.name}: {item_name} を【在庫マイナス最優先割り当て】 "
                             f"(出荷後在庫:{item_info['stock_after_delivery']}台, タクト:{tact_info}秒, "
                             f"残業:{optimal_overtime}分, 型替:{this_shift_changeover_time}分)\n")

            # フェーズ2: その他の品番を処理
            log_file.write("\n  --- フェーズ2: その他の品番（緊急度順） ---\n")
            for item_info in item_urgency:
                # 在庫マイナス品番はフェーズ1で処理済みなのでスキップ
                if item_info['stock_after_delivery'] < 0:
                    continue

                item_name = item_info['item_name']

                # 既にこの品番が別の設備に割り当てられているかチェック
                already_assigned = any(plan['item_name'] == item_name for plan in shift_plans)
                if already_assigned:
                    log_file.write(f"\n    品番:{item_name} → スキップ: この品番は既に別の設備で生産計画済み\n")
                    continue

                # 全設備が割り当て済みなら終了
                if len(assigned_machines) >= len(machines):
                    break

                # デバッグ: 前の直の設備状態を確認
                log_file.write(f"\n    品番:{item_name} (緊急度:{item_info['shifts_until_stockout']}直, "
                             f"生産可能設備:{item_info['available_machine_count']}台)\n")
                log_file.write(f"      前の直の設備状態: ")
                for m in machines:
                    prev = machine_current_item.get(m.id, "未設定")
                    assigned = "割当済" if m.id in assigned_machines else "未割当"
                    log_file.write(f"#{m.name}:{prev}({assigned}), ")
                log_file.write(f"\n")

                # 品番に最適な設備を探す
                machine, is_continuation = find_machine_for_item(item_name)

                if machine is None:
                    log_file.write(f"      → この品番を生産できる設備がありません（全設備が割当済みまたは対応設備なし）\n")
                    continue

                # 判定ロジック（フェーズ2: 在庫マイナスはフェーズ1で処理済み）：
                # 1. 緊急度が高い（URGENCY_THRESHOLD以下）→ 必ず生産
                # 2. 設備制約がある（生産可能設備数が少ない）→ 生産を検討
                # 3. 継続生産可能 → 型替えなしで生産
                # 4. それ以外 → スキップ（型替え削減）
                should_produce = False
                reason = ""

                if item_info['shifts_until_stockout'] <= URGENCY_THRESHOLD:
                    should_produce = True
                    reason = "緊急度が高い"
                elif item_info['available_machine_count'] <= 1:
                    # 1台以下でしか作れない場合は必ず生産
                    should_produce = True
                    reason = "設備制約あり（生産可能設備が限定）"
                elif is_continuation:
                    should_produce = True
                    reason = "継続生産可能（型替えなし）"
                else:
                    should_produce = False
                    reason = "緊急度が低く、設備制約もなく、継続生産でもない"

                if not should_produce:
                    log_file.write(f"      → スキップ: {reason}\n")
                    continue

                # ログ出力
                log_file.write(f"      → 生産決定: {reason}\n")
                if is_continuation:
                    log_file.write(f"      → 設備#{machine.name}で継続生産（型替えなし）\n")
                else:
                    # 継続生産できなかった理由をログ
                    continuation_failed_reason = ""
                    for m in machines:
                        if machine_current_item.get(m.id) == item_name:
                            if m.id in assigned_machines:
                                continuation_failed_reason = f"（注：前の直の設備#{m.name}は既に別の品番に割当済み）"
                            break
                    log_file.write(f"      → 設備#{machine.name}を選択（最速タクト）{continuation_failed_reason}\n")

                # 計画停止時間を取得
                stop_time = stop_time_dict.get((date, shift, machine.id), 0)

                # 前の直と品番が異なる場合、前の直に型替え時間を設定
                prev_item = machine_current_item.get(machine.id)
                this_shift_changeover_time = 0

                if prev_item and prev_item != item_name:
                    # 品番が変わる場合、前の直の最後の計画に型替え時間を追加
                    if machine_plans[machine.id]:
                        prev_plan = machine_plans[machine.id][-1]
                        old_changeover = prev_plan['changeover_time']

                        # 型替え時間をまだ設定していない場合のみ追加
                        if old_changeover == 0:
                            prev_plan['changeover_time'] = CHANGEOVER_TIME

                            # 前の直の生産数を再計算（型替え時間を考慮）
                            prev_key = f"{prev_item}_{machine.id}"
                            prev_data = item_data.get(prev_key)
                            if prev_data:
                                # 古い生産数を取得
                                old_working_time = BASE_TIME[prev_plan['shift']] - prev_plan['stop_time'] - old_changeover + prev_plan['overtime']
                                old_total_prod = math.floor((old_working_time / prev_data['tact']) * occupancy_rate)
                                old_good_prod = math.floor(old_total_prod * prev_data['yield_rate'])

                                # 新しい生産数を計算（型替え時間を引く）
                                new_working_time = BASE_TIME[prev_plan['shift']] - prev_plan['stop_time'] - CHANGEOVER_TIME + prev_plan['overtime']
                                if new_working_time < 0:
                                    new_working_time = 0
                                new_total_prod = math.floor((new_working_time / prev_data['tact']) * occupancy_rate)
                                new_good_prod = math.floor(new_total_prod * prev_data['yield_rate'])

                                # 在庫の差分を修正
                                production_diff = new_good_prod - old_good_prod
                                inventory[prev_item] += production_diff

                                # 前の直の在庫情報を更新
                                prev_plan['after_stock'] = inventory.get(prev_item, 0)

                                log_file.write(f"      【型替え時間設定】前の直（設備#{machine.name}, {prev_item}）に型替え時間{CHANGEOVER_TIME}分を追加\n")
                                log_file.write(f"        前の直の生産数: {old_good_prod}台 → {new_good_prod}台（差分: {production_diff}台）\n")
                                log_file.write(f"        {prev_item}の在庫修正: {inventory.get(prev_item, 0) - production_diff}台 → {inventory.get(prev_item, 0)}台\n")

                    # 現在の直では型替え時間なし（前の直で設定済み）
                    this_shift_changeover_time = 0

                elif prev_item is None:
                    # 前月末のデータがない場合は型替え時間を設定
                    this_shift_changeover_time = CHANGEOVER_TIME

                # この直で既に計画されたこの品番の生産数を取得
                current_shift_planned = planned_production_by_item.get(item_name, 0)

                # この直での出荷数を取得
                delivery = shift_deliveries.get(item_name, 0)

                # 最適な残業時間を計算（在庫が0にならず、かつ1000を超えないように）
                # 継続生産の場合は、在庫を900台に近づけるように最大残業
                optimal_overtime = calculate_optimal_overtime(
                    item_name, machine.id, shift, stop_time, this_shift_changeover_time,
                    current_shift_planned, delivery, is_continuation
                )

                # 生産数を計算
                total_prod, good_prod = calculate_production(
                    item_name, machine.id, shift, stop_time, optimal_overtime, this_shift_changeover_time
                )

                # この直の計画を一時保存
                shift_plans.append({
                    'machine': machine,
                    'item_name': item_name,
                    'overtime': optimal_overtime,
                    'stop_time': stop_time,
                    'changeover_time': this_shift_changeover_time,
                    'total_production': total_prod,
                    'good_production': good_prod
                })

                # 計画生産数を記録
                planned_production_by_item[item_name] += good_prod

                # 設備を割り当て済みとしてマーク
                assigned_machines.add(machine.id)

                # タクト情報を取得
                key = f"{item_name}_{machine.id}"
                tact_info = item_data[key]['tact']

                # ログ出力（緊急度と継続生産を明示）
                if is_continuation:
                    continuation_msg = "【継続生産】"
                else:
                    continuation_msg = ""

                if item_info['shifts_until_stockout'] == 0:
                    log_file.write(f"  設備#{machine.name}: {item_name} を【緊急割り当て】{continuation_msg} "
                                 f"(出荷後在庫:{item_info['stock_after_delivery']}台, タクト:{tact_info}秒, "
                                 f"残業:{optimal_overtime}分, 型替:{this_shift_changeover_time}分)\n")
                else:
                    if is_continuation:
                        log_file.write(f"  設備#{machine.name}: {item_name} を{continuation_msg} "
                                     f"(緊急度: 在庫切れまで{item_info['shifts_until_stockout']}直, "
                                     f"残業:{optimal_overtime}分, 型替:{this_shift_changeover_time}分)\n")
                    else:
                        log_file.write(f"  設備#{machine.name}: {item_name} を割り当て "
                                     f"(タクト:{tact_info}秒で最速, "
                                     f"緊急度: 在庫切れまで{item_info['shifts_until_stockout']}直, "
                                     f"残業:{optimal_overtime}分, 型替:{this_shift_changeover_time}分)\n")

                # 全設備が割り当て済みならループ終了
                if len(assigned_machines) >= len(machines):
                    break

            log_file.write("\n")

            # ステップ2: 計画を確定して在庫を更新
            log_file.write("--- 生産実行 ---\n")
            for plan in shift_plans:
                machine = plan['machine']
                item_name = plan['item_name']
                good_prod = plan['good_production']
                total_prod = plan['total_production']

                # 在庫を更新
                before_stock = inventory.get(item_name, 0)
                after_stock = before_stock + good_prod
                inventory[item_name] = after_stock

                # 生産ログを出力
                key = f"{item_name}_{machine.id}"
                data = item_data.get(key)
                if data:
                    working_time = BASE_TIME[shift] - plan['stop_time'] - plan['changeover_time'] + plan['overtime']
                    log_file.write(f"  設備#{machine.name}: {item_name}\n")
                    log_file.write(f"    基本時間:{BASE_TIME[shift]}分 - 停止:{plan['stop_time']}分 - 型替:{plan['changeover_time']}分 + 残業:{plan['overtime']}分 = 稼働時間:{working_time}分\n")
                    log_file.write(f"    タクト:{data['tact']}秒, 良品率:{data['yield_rate']}, 稼働率:{occupancy_rate}\n")
                    log_file.write(f"    総生産:{total_prod}台, 良品:{good_prod}台\n")
                    log_file.write(f"    在庫: {before_stock} → {after_stock}台\n")

                    # 在庫上限チェック
                    if after_stock > MAX_STOCK:
                        log_file.write(f"    【警告】在庫が上限({MAX_STOCK}台)を超えました！\n")

                # 計画を記録（在庫情報も含める）
                machine_plans[machine.id].append({
                    'date': date,
                    'shift': shift,
                    'item_name': item_name,
                    'overtime': plan['overtime'],
                    'stop_time': plan['stop_time'],
                    'changeover_time': plan['changeover_time'],
                    'before_stock': before_stock,
                    'after_stock': after_stock
                })

                # 現在の品番を更新
                machine_current_item[machine.id] = item_name

            log_file.write("\n")

            # 出荷処理（生産後に出荷）
            log_file.write("--- 出荷処理 ---\n")
            for item_name in sorted(all_item_names):
                delivery = shift_deliveries.get(item_name, 0)
                if delivery > 0:
                    before_stock = inventory.get(item_name, 0)
                    after_stock = before_stock - delivery
                    inventory[item_name] = after_stock
                    log_file.write(f"  {item_name}: {before_stock} → {after_stock} (出荷: {delivery}台)\n")

                    # 在庫不足チェック
                    if after_stock < MIN_STOCK:
                        log_file.write(f"    【警告】在庫が最小値({MIN_STOCK}台)を下回りました！\n")
                    elif after_stock < 50:
                        log_file.write(f"    【注意】在庫が安全レベル(50台)を下回っています。\n")

            log_file.write("\n")

            # 直後の在庫（全品番）
            log_file.write("--- 直後の在庫 ---\n")
            for item_name in sorted(all_item_names):
                log_file.write(f"  {item_name}: {inventory.get(item_name, 0)} 台\n")
            log_file.write("\n")

        # ========================================
        # 650t#1と650t#2の割り当て最適化（全直チェック）
        # ========================================
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【650t#1と650t#2の割り当て最適化】\n")
        log_file.write("=" * 80 + "\n\n")

        # 650t#1と650t#2の設備IDを取得
        machine_650t_1 = None
        machine_650t_2 = None
        for m in machines:
            if m.name == '650t#1':
                machine_650t_1 = m
            elif m.name == '650t#2':
                machine_650t_2 = m

        if machine_650t_1 and machine_650t_2:
            log_file.write("650t#1と650t#2が見つかりました。最適化を開始します。\n\n")

            # 各直について、前の直と比較して入れ替えた方が型替えが減るかチェック
            optimization_count = 0

            for shift_idx, (date, shift) in enumerate(all_shifts):
                # この直の#1と#2の計画を取得
                plan_1 = None
                plan_2 = None
                plan_1_idx = None
                plan_2_idx = None

                for idx, plan in enumerate(machine_plans[machine_650t_1.id]):
                    if plan['date'] == date and plan['shift'] == shift:
                        plan_1 = plan
                        plan_1_idx = idx
                        break

                for idx, plan in enumerate(machine_plans[machine_650t_2.id]):
                    if plan['date'] == date and plan['shift'] == shift:
                        plan_2 = plan
                        plan_2_idx = idx
                        break

                # 両方とも計画がある場合のみ処理
                if not plan_1 or not plan_2:
                    continue

                item_1 = plan_1['item_name']
                item_2 = plan_2['item_name']

                # 同じ品番の場合は入れ替え不要
                if item_1 == item_2:
                    continue

                # 前の直の品番を取得
                prev_item_1 = None
                prev_item_2 = None

                if shift_idx > 0:
                    prev_date, prev_shift = all_shifts[shift_idx - 1]

                    for plan in machine_plans[machine_650t_1.id]:
                        if plan['date'] == prev_date and plan['shift'] == prev_shift:
                            prev_item_1 = plan['item_name']
                            break

                    for plan in machine_plans[machine_650t_2.id]:
                        if plan['date'] == prev_date and plan['shift'] == prev_shift:
                            prev_item_2 = plan['item_name']
                            break

                # 現在の型替え回数を計算
                current_changeovers = 0
                if prev_item_1 and prev_item_1 != item_1:
                    current_changeovers += 1
                if prev_item_2 and prev_item_2 != item_2:
                    current_changeovers += 1

                # 入れ替えた場合の型替え回数を計算
                swapped_changeovers = 0
                if prev_item_1 and prev_item_1 != item_2:  # #1でitem_2を生産
                    swapped_changeovers += 1
                if prev_item_2 and prev_item_2 != item_1:  # #2でitem_1を生産
                    swapped_changeovers += 1

                # 入れ替えても型替え回数が減らない場合はスキップ
                if swapped_changeovers >= current_changeovers:
                    continue

                # 入れ替え可能かチェック（設備-品番マッピング）
                key_1_2 = f"{item_2}_{machine_650t_1.id}"  # #1でitem_2
                key_2_1 = f"{item_1}_{machine_650t_2.id}"  # #2でitem_1

                if key_1_2 not in item_data or key_2_1 not in item_data:
                    log_file.write(f"{date} {shift}直: 【スキップ】設備-品番マッピングが存在しない\n")
                    continue

                log_file.write(f"\n{date} {shift}直:\n")
                log_file.write(f"  入れ替え前:\n")
                log_file.write(f"    #1: {item_1} (前回: {prev_item_1 or '初回'})\n")
                log_file.write(f"    #2: {item_2} (前回: {prev_item_2 or '初回'})\n")
                log_file.write(f"    型替え回数: {current_changeovers}回\n")
                log_file.write(f"  入れ替え後:\n")
                log_file.write(f"    #1: {item_2} (前回: {prev_item_1 or '初回'})\n")
                log_file.write(f"    #2: {item_1} (前回: {prev_item_2 or '初回'})\n")
                log_file.write(f"    型替え回数: {swapped_changeovers}回\n")
                log_file.write(f"  → 型替え回数が {current_changeovers - swapped_changeovers}回減少\n")

                # 入れ替え後は、この直の型替え時間は0（型替えは前の直で行われるため）
                new_changeover_time_1 = 0
                new_changeover_time_2 = 0

                # 元の型替え時間
                old_changeover_time_1 = plan_1['changeover_time']
                old_changeover_time_2 = plan_2['changeover_time']

                # 前の直の型替え時間を更新する必要があるかチェック
                # 入れ替えによって前の直の型替え時間が変わる可能性がある
                if shift_idx > 0:
                    prev_date, prev_shift = all_shifts[shift_idx - 1]

                    # 前の直の#1の計画を取得
                    prev_plan_1 = None
                    prev_plan_1_idx = None
                    for idx, plan in enumerate(machine_plans[machine_650t_1.id]):
                        if plan['date'] == prev_date and plan['shift'] == prev_shift:
                            prev_plan_1 = plan
                            prev_plan_1_idx = idx
                            break

                    # 前の直の#2の計画を取得
                    prev_plan_2 = None
                    prev_plan_2_idx = None
                    for idx, plan in enumerate(machine_plans[machine_650t_2.id]):
                        if plan['date'] == prev_date and plan['shift'] == prev_shift:
                            prev_plan_2 = plan
                            prev_plan_2_idx = idx
                            break

                    # 前の直の#1に型替え時間を設定すべきか判定
                    if prev_plan_1:
                        prev_prev_item_1 = prev_plan_1['item_name']
                        # 入れ替え後: #1でitem_2を生産
                        # 前の直の品番と異なる場合、前の直に型替え時間を設定
                        if prev_prev_item_1 != item_2:
                            if prev_plan_1['changeover_time'] == 0:
                                prev_plan_1['changeover_time'] = CHANGEOVER_TIME
                                log_file.write(f"  【前の直更新】#1の前の直（{prev_date} {prev_shift}）に型替え時間を追加\n")
                        else:
                            # 継続生産なので型替え時間不要
                            if prev_plan_1['changeover_time'] > 0:
                                prev_plan_1['changeover_time'] = 0
                                log_file.write(f"  【前の直更新】#1の前の直（{prev_date} {prev_shift}）の型替え時間を削除（継続生産）\n")

                    # 前の直の#2に型替え時間を設定すべきか判定
                    if prev_plan_2:
                        prev_prev_item_2 = prev_plan_2['item_name']
                        # 入れ替え後: #2でitem_1を生産
                        # 前の直の品番と異なる場合、前の直に型替え時間を設定
                        if prev_prev_item_2 != item_1:
                            if prev_plan_2['changeover_time'] == 0:
                                prev_plan_2['changeover_time'] = CHANGEOVER_TIME
                                log_file.write(f"  【前の直更新】#2の前の直（{prev_date} {prev_shift}）に型替え時間を追加\n")
                        else:
                            # 継続生産なので型替え時間不要
                            if prev_plan_2['changeover_time'] > 0:
                                prev_plan_2['changeover_time'] = 0
                                log_file.write(f"  【前の直更新】#2の前の直（{prev_date} {prev_shift}）の型替え時間を削除（継続生産）\n")

                # 計画停止時間を取得
                stop_time_1 = stop_time_dict.get((date, shift, machine_650t_1.id), 0)
                stop_time_2 = stop_time_dict.get((date, shift, machine_650t_2.id), 0)

                # この直の出荷数を取得
                delivery_item_1 = 0
                delivery_item_2 = 0
                for d in item_delivery.get(item_1, []):
                    if d['date'] == date and d['shift'] == shift:
                        delivery_item_1 = d['count']
                        break
                for d in item_delivery.get(item_2, []):
                    if d['date'] == date and d['shift'] == shift:
                        delivery_item_2 = d['count']
                        break

                # 入れ替え後の残業時間を調整して在庫制約を満たすように計算
                # この直より前の在庫を再計算
                inventory_before_shift = {item: prev_inventory.get(item, 0) for item in all_item_names}

                # この直より前の全生産・出荷を再計算
                for idx, (prev_date, prev_shift) in enumerate(all_shifts[:shift_idx]):
                    # 生産
                    for m in machines:
                        for plan in machine_plans[m.id]:
                            if plan['date'] == prev_date and plan['shift'] == prev_shift:
                                # 生産数を計算
                                _, good_prod = calculate_production(
                                    plan['item_name'], m.id, prev_shift,
                                    stop_time_dict.get((prev_date, prev_shift, m.id), 0),
                                    plan['overtime'],
                                    plan['changeover_time']
                                )
                                inventory_before_shift[plan['item_name']] += good_prod
                                break

                    # 出荷
                    for item_name in all_item_names:
                        for d in item_delivery.get(item_name, []):
                            if d['date'] == prev_date and d['shift'] == prev_shift:
                                inventory_before_shift[item_name] -= d['count']
                                break

                # この直の他の設備（800t#3）の生産数を計算
                other_production_item_1 = 0
                other_production_item_2 = 0

                for m in machines:
                    if m.id == machine_650t_1.id or m.id == machine_650t_2.id:
                        continue

                    for plan in machine_plans[m.id]:
                        if plan['date'] == date and plan['shift'] == shift:
                            # 生産数を計算
                            _, good_prod = calculate_production(
                                plan['item_name'], m.id, shift,
                                stop_time_dict.get((date, shift, m.id), 0),
                                plan['overtime'],
                                plan['changeover_time']
                            )
                            if plan['item_name'] == item_1:
                                other_production_item_1 += good_prod
                            elif plan['item_name'] == item_2:
                                other_production_item_2 += good_prod
                            break

                # 残業時間の組み合わせを全探索して制約を満たす最適な組み合わせを見つける
                best_overtime_1 = None
                best_overtime_2 = None
                best_prod_1 = 0
                best_prod_2 = 0
                found_valid = False

                for ot1 in range(0, OVERTIME_MAX[shift] + 1, 5):
                    for ot2 in range(0, OVERTIME_MAX[shift] + 1, 5):
                        # #1でitem_2を生産
                        _, gp1 = calculate_production(
                            item_2, machine_650t_1.id, shift, stop_time_1, ot1, new_changeover_time_1
                        )

                        # #2でitem_1を生産
                        _, gp2 = calculate_production(
                            item_1, machine_650t_2.id, shift, stop_time_2, ot2, new_changeover_time_2
                        )

                        # 在庫計算
                        stock_1_prod = inventory_before_shift[item_1] + other_production_item_1 + gp2
                        stock_1_deliv = stock_1_prod - delivery_item_1

                        stock_2_prod = inventory_before_shift[item_2] + other_production_item_2 + gp1
                        stock_2_deliv = stock_2_prod - delivery_item_2

                        # 制約チェック
                        if (MIN_STOCK <= stock_1_deliv and stock_1_prod <= MAX_STOCK and
                            MIN_STOCK <= stock_2_deliv and stock_2_prod <= MAX_STOCK):
                            # 制約を満たす組み合わせが見つかった
                            # より多く生産できる組み合わせを優先（安全在庫確保）
                            if not found_valid or (gp1 + gp2) > (best_prod_1 + best_prod_2):
                                best_overtime_1 = ot1
                                best_overtime_2 = ot2
                                best_prod_1 = gp1
                                best_prod_2 = gp2
                                found_valid = True

                if found_valid:
                    # 在庫制約を満たす組み合わせが見つかった
                    log_file.write(f"\n  【調整成功】残業時間を調整して制約を満たしました\n")
                    log_file.write(f"    #1の残業: {best_overtime_1}分 → {item_2}を{best_prod_1}台生産\n")
                    log_file.write(f"    #2の残業: {best_overtime_2}分 → {item_1}を{best_prod_2}台生産\n")

                    # 在庫予測を出力
                    stock_1_prod = inventory_before_shift[item_1] + other_production_item_1 + best_prod_2
                    stock_1_deliv = stock_1_prod - delivery_item_1
                    stock_2_prod = inventory_before_shift[item_2] + other_production_item_2 + best_prod_1
                    stock_2_deliv = stock_2_prod - delivery_item_2

                    log_file.write(f"    {item_1}: 生産後{stock_1_prod}台 → 出荷後{stock_1_deliv}台\n")
                    log_file.write(f"    {item_2}: 生産後{stock_2_prod}台 → 出荷後{stock_2_deliv}台\n")

                    # planを更新
                    machine_plans[machine_650t_1.id][plan_1_idx]['item_name'] = item_2
                    machine_plans[machine_650t_1.id][plan_1_idx]['overtime'] = best_overtime_1
                    machine_plans[machine_650t_1.id][plan_1_idx]['changeover_time'] = new_changeover_time_1

                    machine_plans[machine_650t_2.id][plan_2_idx]['item_name'] = item_1
                    machine_plans[machine_650t_2.id][plan_2_idx]['overtime'] = best_overtime_2
                    machine_plans[machine_650t_2.id][plan_2_idx]['changeover_time'] = new_changeover_time_2

                    log_file.write(f"  → 入れ替えを実行しました\n")
                    optimization_count += 1
                else:
                    # 制約を満たす組み合わせが見つからなかった
                    log_file.write(f"\n  【調整失敗】どの残業時間の組み合わせでも制約を満たせませんでした\n")
                    log_file.write(f"  → 入れ替えをキャンセル\n")

            log_file.write(f"\n最適化実施回数: {optimization_count}回\n")
        else:
            log_file.write("650t#1または650t#2が見つかりませんでした。最適化をスキップします。\n")

        # 最終在庫状態のサマリー
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【最終在庫状態サマリー】\n")
        log_file.write("=" * 80 + "\n\n")

        has_warning = False
        for item_name in sorted(all_item_names):
            final_stock = inventory.get(item_name, 0)
            log_file.write(f"  {item_name}: {final_stock}台 ")

            if final_stock < MIN_STOCK:
                log_file.write("【警告: 在庫不足！】")
                has_warning = True
            elif final_stock < 50:
                log_file.write("【注意: 安全レベル以下】")
                has_warning = True
            elif final_stock > MAX_STOCK:
                log_file.write("【警告: 在庫過剰！】")
                has_warning = True
            elif final_stock > 900:
                log_file.write("【注意: 上限接近】")

            log_file.write("\n")

        if not has_warning:
            log_file.write("\n✓ すべての品番が適正在庫範囲内です。\n")

        # 型替え回数の統計
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【型替え回数統計】\n")
        log_file.write("=" * 80 + "\n\n")
        log_file.write(f"  総型替え回数: {total_changeovers}回\n\n")
        log_file.write("  設備別型替え回数:\n")

        # ログファイルを閉じる
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("計画完了\n")
        log_file.write("=" * 80 + "\n")
        log_file.close()

        # 結果をフォーマット
        result = []
        log_file = open(log_file_path, 'a', encoding='utf-8')
        log_file.write("\n" + "=" * 80 + "\n")
        log_file.write("【返却データ確認】\n")
        log_file.write("=" * 80 + "\n\n")

        for machine in machines:
            log_file.write(f"設備: ID={machine.id}, Name={machine.name}\n")
            plan_count = 0
            for plan in machine_plans[machine.id]:
                plan_count += 1
                result.append({
                    'machine_id': machine.id,
                    'machine_name': machine.name,
                    'date': plan['date'].isoformat(),
                    'shift': plan['shift'],
                    'item_name': plan['item_name'],
                    'overtime': plan['overtime'],
                    'mold_count': 0,  # カバーラインでは金型管理なし
                    'changeover_time': plan['changeover_time']
                })
                log_file.write(f"  {plan['date']} {plan['shift']}: {plan['item_name']} (残業:{plan['overtime']}分, 型替:{plan['changeover_time']}分)\n")
            log_file.write(f"  計画数: {plan_count}件\n\n")

        log_file.write(f"\n返却データ総数: {len(result)}件\n")
        log_file.close()

        return {
            'plans': result,
            'unused_molds': []  # カバーラインでは金型管理なし
        }
