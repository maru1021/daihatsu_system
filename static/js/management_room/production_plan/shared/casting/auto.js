// ========================================
// 自動生産計画モジュール（鋳造・CVT共通）
// ========================================
// 自動生産計画の生成と適用処理を共通化
//
// 使用例:
// import { autoProductionPlan, applyAutoProductionPlan } from './shared/casting/auto.js';
// autoProductionPlan({
//     domConstantCache: {...},
//     getCookie: (name) => {...},
//     showToast: (type, message) => {...},
//     onSuccess: (data) => {...}
// });

import { getCookie as defaultGetCookie } from './utils.js';

/**
 * 自動生産計画を生成
 * @param {Object} options - オプション設定
 * @param {Object} options.domConstantCache - DOM定数キャッシュ
 * @param {string} options.apiUrl - 自動生成APIのURL（デフォルト: 鋳造用URL）
 * @param {Function} options.getCookie - Cookieを取得する関数（オプション）
 * @param {Function} options.showToast - トースト表示関数（オプション）
 * @param {Function} options.showLoading - ローディング表示関数（オプション）
 * @param {Function} options.hideLoading - ローディング非表示関数（オプション）
 * @param {Function} options.onSuccess - 成功時のコールバック（オプション）
 * @param {Function} options.applyPlan - 計画適用関数
 */
export function autoProductionPlan(options = {}) {
    const {
        domConstantCache = null,
        apiUrl = '/management_room/production-plan/casting-production-plan/auto/',
        getCookie: getCookieFn = defaultGetCookie,
        showToast = window.showToast || ((type, msg) => alert(msg)),
        showLoading = window.showLoading || (() => {}),
        hideLoading = window.hideLoading || (() => {}),
        onSuccess = null,
        applyPlan = null
    } = options;

    const autoBtn = document.getElementById('auto-btn');
    if (!autoBtn) {
        console.error('Auto button not found');
        return;
    }

    autoBtn.disabled = true;
    autoBtn.textContent = '計算中...';

    // 対象年月を取得
    const targetMonthInput = document.getElementById('target-month');
    const selectedMonth = targetMonthInput ? targetMonthInput.value : null;

    if (!selectedMonth) {
        showToast('error', '対象月を選択してください');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        return;
    }

    // ローディング表示を開始
    showLoading();

    const [year, month] = selectedMonth.split('-');
    const lineSelect = document.getElementById('line-select');
    const lineId = (typeof $ !== 'undefined' && $(lineSelect).data('select2'))
        ? $(lineSelect).val()
        : lineSelect.value;

    // 計画停止データを収集
    const stopTimeData = [];
    const stopTimeInputs = document.querySelectorAll('.stop-time-input');
    stopTimeInputs.forEach(input => {
        if (input.style.display !== 'none' && input.value) {
            const dateIndex = parseInt(input.dataset.dateIndex);
            const shift = input.dataset.shift;
            const machineIndex = parseInt(input.dataset.machineIndex);
            const stopTime = parseInt(input.value) || 0;

            // 日付を取得
            const dateHeaders = document.querySelectorAll('thead tr:nth-child(2) th');
            if (dateIndex < dateHeaders.length) {
                const dateText = dateHeaders[dateIndex].textContent.trim();
                const match = dateText.match(/(\d+)\/(\d+)/);
                if (match) {
                    const monthNum = parseInt(match[1]);
                    const day = parseInt(match[2]);
                    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    stopTimeData.push({
                        date: dateStr,
                        shift: shift,
                        machine_id: machineIndex,
                        stop_time: stopTime
                    });
                }
            }
        }
    });

    // 休出日を収集
    const weekendWorkDates = [];
    if (domConstantCache && domConstantCache.checkCells) {
        const checkCells = domConstantCache.checkCells;
        checkCells.forEach((cell, index) => {
            const isWeekend = cell.getAttribute('data-weekend') === 'true';
            const checkText = cell.textContent.trim();

            if (isWeekend && checkText === '休出') {
                const dateHeaders = document.querySelectorAll('thead tr:nth-child(2) th');
                if (index < dateHeaders.length) {
                    const dateText = dateHeaders[index].textContent.trim();
                    const match = dateText.match(/(\d+)\/(\d+)/);
                    if (match) {
                        const monthNum = parseInt(match[1]);
                        const day = parseInt(match[2]);
                        const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        weekendWorkDates.push(dateStr);
                    }
                }
            }
        });
    }

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookieFn('csrftoken');

    if (!csrfToken) {
        showToast('error', 'CSRFトークンが取得できませんでした。ページをリロードしてください。');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        hideLoading();
        return;
    }

    // 自動生産計画APIを呼び出し
    fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            year: parseInt(year),
            month: parseInt(month),
            line_id: lineId,
            stop_time_data: stopTimeData,
            weekend_work_dates: weekendWorkDates
        })
    })
        .then(response => response.json())
        .then(async data => {
            if (data.status === 'success') {
                // 金型管理（Casting）またはデフォルト処理
                window.autoGeneratedUnusedMolds = data.unused_molds || [];

                // ローディング表示を終了
                hideLoading();

                // トーストを表示
                showToast('success', '自動生産計画を適用しました。保存ボタンを押してください。');

                // ライン固有の成功時処理
                if (onSuccess) {
                    await onSuccess(data);
                }

                // ブラウザにレンダリング時間を与えてから重い処理を実行
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => requestAnimationFrame(resolve));

                // 生産計画を画面に非同期で反映
                if (applyPlan) {
                    await applyPlan(data.data);
                }
            } else {
                hideLoading();
                showToast('error', '自動生産計画の生成に失敗しました: ' + (data.message || ''));
            }
        })
        .catch(error => {
            hideLoading();
            showToast('error', '自動生産計画の生成に失敗しました: ' + error.message);
        })
        .finally(() => {
            autoBtn.disabled = false;
            autoBtn.textContent = '自動';
        });
}

/**
 * 自動生産計画を画面に適用
 * @param {Array} planData - 計画データ
 * @param {Object} options - オプション設定
 * @param {Object} options.domConstantCache - DOM定数キャッシュ
 * @param {Function} options.updateSelectColor - セレクトボックスの色を更新する関数
 * @param {Function} options.calculateProduction - 生産台数を計算する関数
 * @param {Function} options.recalculateAllInventory - 在庫を再計算する関数
 * @param {Function} options.applyItemChangeHighlights - 品番変更ハイライトを適用する関数
 * @param {Function} options.onPlanApplied - 計画適用後のコールバック（Casting: 金型管理処理等）
 */
export async function applyAutoProductionPlan(planData, options = {}) {
    const {
        domConstantCache = null,
        updateSelectColor = () => {},
        calculateProduction = () => {},
        recalculateAllInventory = () => {},
        applyItemChangeHighlights = () => {},
        onPlanApplied = null
    } = options;

    // テーブルを一時的に非表示にしてReflow/Repaintを抑制
    const table = document.querySelector('.production-plan-table');
    if (table) {
        table.style.display = 'none';
    }

    // 日付ヘッダー行（2行目）から全日付とインデックスのマッピングを作成
    const dateHeaderRow = document.querySelector('thead tr:nth-child(2)');
    const dateHeaders = dateHeaderRow ? dateHeaderRow.querySelectorAll('th') : [];
    const dateToIndexMap = {};

    dateHeaders.forEach((th, index) => {
        const text = th.textContent.trim();
        // "10/1(水)" のような形式から日付部分を抽出
        const match = text.match(/\d+\/(\d+)/);
        if (match) {
            const day = parseInt(match[1]);
            dateToIndexMap[day] = index;
        }
    });

    // 鋳造機名とインデックスのマッピングを作成
    const machineIndexMap = {};
    const machineRows = document.querySelectorAll('.facility-number');

    // 生産計画の行は日勤N台、夜勤N台、型替えN台×2、残業N台×2、停止N台×2の計8セクションあるので、
    // 全体の1/8が設備数
    const machineCount = machineRows.length / 8;

    machineRows.forEach((row, index) => {
        const machineName = row.textContent.trim();
        // 日勤の生産計画行のみをマッピング（最初のmachineCount個）
        if (index < machineCount) {
            machineIndexMap[machineName] = index;
        }
    });

    let updatedCount = 0;
    let notFoundCount = 0;

    // 各プランを適用
    planData.forEach(plan => {
        const dateObj = new Date(plan.date + 'T00:00:00');
        const day = dateObj.getDate();

        // 日付のインデックスを取得
        const dateIndex = dateToIndexMap[day];

        if (dateIndex === undefined) {
            notFoundCount++;
            return;
        }

        const machineIndex = machineIndexMap[plan.machine_name];
        if (machineIndex === undefined) {
            notFoundCount++;
            return;
        }

        // 生産計画のselectを更新
        const planSelect = document.querySelector(
            `.vehicle-select[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (planSelect) {
            planSelect.value = plan.item_name;
            updateSelectColor(planSelect);
            updatedCount++;
        } else {
            notFoundCount++;
        }

        // 残業時間を更新
        const overtimeInput = document.querySelector(
            `.overtime-input[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (overtimeInput) {
            overtimeInput.value = plan.overtime;
        }

        // 型替え時間を更新
        const moldChangeInput = document.querySelector(
            `.mold-change-input[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (moldChangeInput) {
            const changeoverTime = plan.changeover_time || 0;
            moldChangeInput.value = changeoverTime;
        }
    });

    // ブラウザにレンダリング時間を与える
    await new Promise(resolve => requestAnimationFrame(resolve));

    // 生産台数を再計算（全日付のインデックスで）
    const allDateIndices = Object.values(dateToIndexMap);
    allDateIndices.forEach(dateIndex => {
        calculateProduction(dateIndex, 'day');
        calculateProduction(dateIndex, 'night');
    });

    // 在庫を再計算
    recalculateAllInventory();

    // ライン固有の計画適用後処理（Casting: 金型カウント再計算、引き継ぎ矢印等）
    if (onPlanApplied) {
        await onPlanApplied(allDateIndices);
    }

    // 品番変更をチェック（バックエンドで型替え時間を設定済みなので、ハイライトのみ適用）
    applyItemChangeHighlights();

    // テーブルを再表示
    if (table) {
        table.style.display = '';
    }
}
