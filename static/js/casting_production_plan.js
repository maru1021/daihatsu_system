// ========================================
// 鋳造生産計画JavaScript
// ========================================
// このファイルは加工生産計画(machining_production_plan.js)と統一された構造を持ちます
// 主な違い:
// - 定時時間: 鋳造 490/485分 vs 加工 455/450分
// - 設備選択: 鋳造は設備ごとに品番を選択、加工は生産数を直接入力
// - 在庫計算: 鋳造は設備ベースで自動計算、加工は手動入力と自動計算の混合
//
// ========================================
// パフォーマンス最適化の要点
// ========================================
// 1. キャッシュ戦略:
//    - DOM要素をキャッシュして繰り返しquerySelectorを回避
//    - 計算結果をキャッシュして重複計算を削減
// 2. 非同期処理:
//    - 重い計算（溶湯、ポット数、中子）をrequestIdleCallbackで遅延実行
//    - 初期表示を高速化（在庫計算 → 月末在庫カード → 行合計/溶湯は非同期）
// 3. チラつき防止:
//    - サーバーサイドでインラインスタイルを設定
//    - HTMLヘッダーにCSSルールを追加（!important）
//    - JavaScript初期化で最終確認
// 4. ループ最適化:
//    - forEach()よりもforループを使用（関数呼び出しのオーバーヘッド削減）
//    - 不要なDOM操作を削減（現在の状態をチェックしてから変更）

// ========================================
// 定数
// ========================================
const REGULAR_TIME_DAY = 490;     // 鋳造の日勤定時時間（分）
const REGULAR_TIME_NIGHT = 485;   // 鋳造の夜勤定時時間（分）
const OVERTIME_MAX_DAY = 120;     // 日勤の残業上限（分）
const OVERTIME_MAX_NIGHT = 60;    // 夜勤の残業上限（分）
const MOLD_CHANGE_THRESHOLD = 6;  // 金型交換が必要な使用回数
// 品番ごとの背景色を設定
const colorMap = {
    'VE': '#D6EAF8',
    'VE4': '#D6EAF8',
    'VET2': '#F8BBD0',
    'VE7': '#87CEEB',
    'VET': '#90EE90',
    'VE5': '#FFE4C4',
    'POL': '#56d9f0ff',
    'CCH': '#91f48aff',
    'CCS': '#fdbe92ff',
    'POL(7)': '#9076faff',
    'CCL': '#fb50deff',
    'CCL(7)': '#fb50deff',
};

// ========================================
// グローバル変数（HTMLから渡される）
// ========================================
/* global itemData, previousMonthInventory, previousMonthProductionPlans, prevUsableMolds */

// 初期化フラグ（ページ読み込み時はtrue、その後はfalse）
let isInitializing = true;

// 再利用可能金型の管理
// [{ id: 一意ID, itemName: 品番, count: 使用回数, dateIndex: 日付, shift: 直, machineIndex: 設備番号 }, ...]
let reusableMolds = [];
let reusableMoldIdCounter = 0;  // 一意IDのカウンター

// ========================================
// グローバルキャッシュ（パフォーマンス最適化用）
// ========================================
let vehicleSelectCache = null;
let moldChangeInputCache = null;
let selectContainerCache = null;

// 頻繁にアクセスされる定数値のキャッシュ
let domConstantCache = {
    dateCount: 0,        // 日付数
    totalMachines: 0,    // 設備数
    checkCells: null,    // チェックセル
    facilityNumbers: null // 設備番号要素
};

// selectの二次元配列キャッシュ（O(1)アクセス）
// selectElementCache[shift][dateIndex][machineIndex] で直接アクセス可能
let selectElementCache = {
    day: [],
    night: []
};

// mold-count-displayの二次元配列キャッシュ
let moldCountDisplayCache = {
    day: [],
    night: []
};

function buildDOMCache() {
    // 定数値をキャッシュ（DOM検索を削減）
    domConstantCache.dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;
    domConstantCache.facilityNumbers = document.querySelectorAll('.facility-number');
    domConstantCache.totalMachines = domConstantCache.facilityNumbers.length / 4;
    domConstantCache.checkCells = document.querySelectorAll('.check-cell');

    // select要素を二次元配列でキャッシュ
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    selectElementCache.day = [];
    selectElementCache.night = [];
    moldCountDisplayCache.day = [];
    moldCountDisplayCache.night = [];

    for (let d = 0; d < dateCount; d++) {
        selectElementCache.day[d] = [];
        selectElementCache.night[d] = [];
        moldCountDisplayCache.day[d] = [];
        moldCountDisplayCache.night[d] = [];

        for (let m = 0; m < totalMachines; m++) {
            // select要素をキャッシュ
            selectElementCache.day[d][m] = document.querySelector(
                `.vehicle-select[data-shift="day"][data-date-index="${d}"][data-machine-index="${m}"]`
            );
            selectElementCache.night[d][m] = document.querySelector(
                `.vehicle-select[data-shift="night"][data-date-index="${d}"][data-machine-index="${m}"]`
            );

            // mold-count-display要素をキャッシュ
            moldCountDisplayCache.day[d][m] = document.querySelector(
                `.mold-count-display[data-shift="day"][data-date-index="${d}"][data-machine-index="${m}"]`
            );
            moldCountDisplayCache.night[d][m] = document.querySelector(
                `.mold-count-display[data-shift="night"][data-date-index="${d}"][data-machine-index="${m}"]`
            );
        }
    }

    // 旧形式のMapキャッシュも互換性のため維持（既存コードで使用されている可能性あり）
    vehicleSelectCache = new Map();
    document.querySelectorAll('.vehicle-select').forEach(select => {
        const key = `${select.dataset.shift}-${select.dataset.dateIndex}-${select.dataset.machineIndex}`;
        vehicleSelectCache.set(key, select);
    });

    // 金型交換のinputをキャッシュ
    moldChangeInputCache = new Map();
    document.querySelectorAll('.mold-change-input').forEach(input => {
        const key = `${input.dataset.shift}-${input.dataset.dateIndex}-${input.dataset.machineIndex}`;
        moldChangeInputCache.set(key, input);
    });

    // select-containerをキャッシュ
    // 型替えの色の制御に使用
    selectContainerCache = Array.from(document.querySelectorAll('.select-container'));
}

// ========================================
// ユーティリティ関数
// ========================================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 次の直に移動するヘルパー関数
// 戻り値: { dateIndex: 次の日付インデックス, shift: 次の直 }
function moveToNextShift(dateIndex, shift) {
    if (shift === 'day') {
        return { dateIndex: dateIndex, shift: 'night' };
    } else {
        return { dateIndex: dateIndex + 1, shift: 'day' };
    }
}

// 前の直に移動するヘルパー関数
// 戻り値: { dateIndex: 前の日付インデックス, shift: 前の直 }
function moveToPrevShift(dateIndex, shift) {
    if (shift === 'day') {
        return { dateIndex: dateIndex - 1, shift: 'night' };
    } else {
        return { dateIndex: dateIndex, shift: 'day' };
    }
}

// 次の稼働している直のselect要素を取得
// 戻り値: 次の稼働している直のselect要素（見つからない場合はnull）
function getNextWorkingShift(dateIndex, shift, machineIndex) {
    if (shift === 'day') {
        // 日勤の場合: 同じ日の夜勤を取得
        const nightKey = `night-${dateIndex}-${machineIndex}`;
        const nightCandidate = vehicleSelectCache.get(nightKey);
        // 夜勤が存在し、かつ品番が入っている場合のみ
        if (nightCandidate && nightCandidate.value && nightCandidate.value.trim() !== '') {
            return nightCandidate;
        }
    } else {
        // 夜勤の場合: 次の稼働日の日勤を取得（土日や休日を跨ぐ可能性を考慮）
        // 最大10日先まで探す（長期休暇も考慮）
        for (let offset = 1; offset <= 10; offset++) {
            const nextDayKey = `day-${dateIndex + offset}-${machineIndex}`;
            const candidateSelect = vehicleSelectCache.get(nextDayKey);
            // 次の日勤が存在し、かつ品番が入っている場合のみ
            if (candidateSelect && candidateSelect.value && candidateSelect.value.trim() !== '') {
                return candidateSelect;
            }
        }
    }
    return null;
}

// 前の稼働している直のselect要素を取得
// 戻り値: 前の稼働している直のselect要素（見つからない場合はnull）
function getPrevWorkingShift(dateIndex, shift, machineIndex) {
    if (shift === 'day') {
        // 日勤の場合: 前の稼働日の夜勤を取得（夜勤→日勤の変更チェック）
        // 最大10日前まで探す（土日や長期休暇を考慮）
        for (let offset = 1; offset <= 10; offset++) {
            const prevNightKey = `night-${dateIndex - offset}-${machineIndex}`;
            const candidateSelect = vehicleSelectCache.get(prevNightKey);
            // 前の夜勤が存在し、かつ品番が入っている場合のみ
            if (candidateSelect && candidateSelect.value && candidateSelect.value.trim() !== '') {
                return candidateSelect;
            }
        }
    }
    // 夜勤の場合は前の直の概念がないため、nullを返す
    return null;
}

// 品番リストを取得
function getItemNames() {
    const itemNames = [];
    document.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
        itemNames.push(label.textContent.trim());
    });
    return itemNames;
}

// 入力要素を取得
function getInputElement(selector) {
    return document.querySelector(selector);
}

// 入力値を取得（非表示の場合は0を返す）
function getInputValue(input) {
    return input && input.style.display !== 'none' ? (parseInt(input.value) || 0) : 0;
}

// CSRFトークンを取得
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// ========================================
// 定時チェック機能
// ========================================
// デバウンスされたupdateWorkingDayStatus関数
const debouncedUpdateWorkingDayStatus = debounce(function (dateIndex) {
    updateWorkingDayStatus(dateIndex);
}, 100);

function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent;

    const newText = currentText === '' ? (isWeekend ? '休出' : '定時') : '';
    element.textContent = newText;

    // data-regular-hours属性を更新
    element.setAttribute('data-regular-hours', newText === '定時' ? 'true' : 'false');

    // 日付インデックスを取得
    const dateIndex = Array.from(element.parentElement.children).indexOf(element) - 1;

    // デバウンスされた更新関数を呼び出し（特定の日付のみ更新）
    debouncedUpdateWorkingDayStatus(dateIndex);

    // 残業inputの表示/非表示を更新
    updateOvertimeInputVisibility();
}

// ========================================
// 週末の休出状態と平日の定時状態を初期化
// ========================================
function initializeWeekendWorkingStatus() {
    // 全ての日付のチェックセルを走査
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const isRegularHours = checkCell.getAttribute('data-regular-hours') === 'true';

        if (isWeekend) {
            // 週末の初期化処理
            // DailyMachineCastingProductionPlanデータの有無で判断
            const hasWeekendWork = checkCell.getAttribute('data-has-weekend-work') === 'true';

            // データがあれば「休出」をセット、なければ空にする
            if (hasWeekendWork) {
                checkCell.textContent = '休出';
                checkCell.setAttribute('data-regular-hours', 'false');
            } else {
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');
            }
        } else {
            // 平日の初期化処理
            if (isRegularHours) {
                checkCell.textContent = '定時';
                checkCell.setAttribute('data-regular-hours', 'true');
            } else {
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');
            }
        }
    });
}

// ========================================
// 稼働日状態の更新
// ========================================
function updateWorkingDayStatus(recalculate = true) {
    // 全ての日付のチェックセルを走査
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const dateStr = checkCell.getAttribute('data-date');
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();

        // 日付文字列から日付インデックスを取得（"10/1" -> 0）
        const dateIndex = Array.from(checkCell.parentElement.children).indexOf(checkCell) - 1;

        if (isWeekend) {
            // 週末の場合
            const isWorking = checkText === '休出';
            const hasWeekendDelivery = checkCell.getAttribute('data-has-weekend-delivery') === 'true';

            // 日勤の入力フィールドを制御（残業input以外） - 非表示で制御
            const dayInputs = document.querySelectorAll(
                `[data-shift="day"][data-date-index="${dateIndex}"] input`
            );
            dayInputs.forEach(input => {
                // 残業inputは除外（updateOvertimeInputVisibility()で制御）
                if (input.classList.contains('overtime-input')) {
                    return;
                }

                // 出庫数・在庫数インプットの場合、出庫数データがあれば表示
                if ((input.classList.contains('delivery-input') || input.classList.contains('inventory-input')) && hasWeekendDelivery) {
                    input.style.display = '';
                } else if (isWorking) {
                    input.style.display = '';
                } else {
                    input.style.display = 'none';
                }
            });

            // 生産計画のselectとコンテナを制御
            const daySelectContainers = document.querySelectorAll(
                `td[data-shift="day"][data-date-index="${dateIndex}"] .select-container`
            );
            daySelectContainers.forEach(container => {
                if (isWorking) {
                    container.style.display = '';
                } else {
                    container.style.display = 'none';
                }
            });

            // 稼働率入力を制御 - 非表示で制御
            const operationRateInput = document.querySelector(
                `.operation-rate-input[data-date-index="${dateIndex}"]`
            );
            if (operationRateInput) {
                if (isWorking) {
                    operationRateInput.style.display = '';
                } else {
                    operationRateInput.style.display = 'none';
                }
            }
        } else {
            // 平日の場合
            const isRegularTime = checkText === '定時';

            // 日勤の残業時間入力を制御（定数を使用）
            const dayOvertimeInputs = document.querySelectorAll(
                `.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`
            );
            dayOvertimeInputs.forEach(input => {
                if (isRegularTime) {
                    input.max = 0;
                    input.value = 0;
                } else {
                    input.max = OVERTIME_MAX_DAY;
                }
            });
        }
    });

    // 生産台数と在庫を再計算（初期化時はスキップして重複を避ける）
    if (recalculate) {
        const dateCount = domConstantCache.dateCount;
        for (let i = 0; i < dateCount; i++) {
            calculateProduction(i, 'day');
            calculateProduction(i, 'night');
        }
        recalculateAllInventory();
    }
}

// ========================================
// 生産計画セレクト色管理
// ========================================
function updateSelectColor(select) {
    const value = select.value || (typeof $ !== 'undefined' && $(select).val());
    select.setAttribute('data-vehicle', value);

    if (value && colorMap[value]) {
        select.style.backgroundColor = colorMap[value];
        // すべて黒文字
        select.style.color = '#000000';
    } else {
        // デフォルトに戻す
        select.style.backgroundColor = '';
        select.style.color = '';
    }
}

function initializeSelectColors() {
    // デバウンスされた品番変更チェック関数（200ms遅延）
    const debouncedApplyHighlights = debounce(applyItemChangeHighlights, 200);

    document.querySelectorAll('.vehicle-select').forEach(select => {
        updateSelectColor(select);

        select.addEventListener('change', function () {
            // 変更前の品番を取得（updateSelectColorの前に取得する必要がある）
            const oldItem = this.getAttribute('data-vehicle') || '';
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            const machineIndex = parseInt(this.dataset.machineIndex);

            // 【重要】変更前の金型情報を保存（updateMoldCountで属性がクリアされる前に）
            const moldDisplay = moldCountDisplayCache[shift]?.[dateIndex]?.[machineIndex];
            const oldMoldInfo = {
                isPrevMonthMold: moldDisplay?.getAttribute('data-prev-month-mold') === 'true',
                prevMonthCount: parseInt(moldDisplay?.getAttribute('data-prev-month-count')) || 0,
                currentCount: parseInt(moldDisplay?.textContent) || 0
            };


            updateSelectColor(this);  // ここで data-vehicle が新しい値に更新される
            const newItem = this.value || '';

            updateMoldCountForMachineFromShift(dateIndex, shift, machineIndex, oldItem, newItem, oldMoldInfo);  // この直以降の金型使用数を更新（生産台数・在庫も計算される）
            debouncedApplyHighlights();  // ハイライトのみ更新（型替え時間は設定しない）
        });
    });
}

// ========================================
// 金型使用数更新
// ========================================
function updateMoldCount(dateIndex, shift, machineIndex) {
    // キャッシュから直接取得（O(1)アクセス）
    const select = selectElementCache[shift]?.[dateIndex]?.[machineIndex];
    if (!select) return;

    const currentItem = select.value;

    // mold-count-displayもキャッシュから取得
    const moldCountDisplay = moldCountDisplayCache[shift]?.[dateIndex]?.[machineIndex];
    if (!moldCountDisplay) return;


    // 前月末金型の場合、品番が一致する限り再計算をスキップ（既に計算済みの値を保持）
    const isPrevMonthMold = moldCountDisplay.getAttribute('data-prev-month-mold') === 'true';
    if (isPrevMonthMold && currentItem) {
        const prevMonthItemName = moldCountDisplay.getAttribute('data-prev-month-item');
        const currentDisplayedCount = parseInt(moldCountDisplay.textContent) || 0;


        // 品番が一致し、既に表示されているカウントがある場合のみ、その値を保持
        if (currentItem === prevMonthItemName && currentDisplayedCount > 0 && currentDisplayedCount <= MOLD_CHANGE_THRESHOLD) {
            // 既に計算済みのカウントをそのまま使用（再計算しない）
            moldCountDisplay.setAttribute('data-inherited', 'false');

            // 6直完了の場合、リセット情報を設定し、前月金型を消費済みにマーク
            if (currentDisplayedCount === MOLD_CHANGE_THRESHOLD) {
                const resetInfo = JSON.stringify({
                    dateIndex: dateIndex,
                    shift: shift,
                    machineIndex: machineIndex,
                    itemName: currentItem
                });
                moldCountDisplay.setAttribute('data-reset-info', resetInfo);

                // 前月金型を消費済みにマーク
                const cellKey = `${dateIndex}-${shift}-${machineIndex}`;
                checkAndMarkPrevMonthMoldExhausted(cellKey, currentDisplayedCount);
            } else {
                moldCountDisplay.removeAttribute('data-reset-info');
            }
            return;
        } else {
            // 品番が変更された場合、または6を超えた場合、フラグをクリア
            moldCountDisplay.removeAttribute('data-prev-month-mold');
            moldCountDisplay.removeAttribute('data-prev-month-count');
            moldCountDisplay.removeAttribute('data-prev-month-item');
        }
    }

    if (!currentItem) {
        // 品番が空の場合は空文字にする
        moldCountDisplay.textContent = '';
        moldCountDisplay.removeAttribute('data-reset-info');
        moldCountDisplay.setAttribute('data-inherited', 'false');
        moldCountDisplay.setAttribute('data-manual-block', 'false');

        // 引き継ぎ情報をクリア（引き継ぎ元への参照も削除）
        clearInheritanceInfo(moldCountDisplay);
        return;
    }

    // 手動で値が設定されている場合はその値を保持（自動計算しない）
    const isManualOverride = moldCountDisplay.getAttribute('data-manual-override') === 'true';
    if (isManualOverride) {
        const manualValue = parseInt(moldCountDisplay.getAttribute('data-manual-value')) || 1;
        moldCountDisplay.textContent = manualValue;
        moldCountDisplay.setAttribute('data-inherited', 'false');
        moldCountDisplay.removeAttribute('data-reset-info');
        return;
    }

    // 連続して同じ品番を生産している直数を取得
    const countResult = getConsecutiveShiftCountWithSource(dateIndex, shift, machineIndex, currentItem);
    const consecutiveCount = countResult.count;
    const isInherited = countResult.inherited;
    const inheritanceSource = countResult.source; // 引き継ぎ元の情報

    // 金型使用数spanに値を設定
    moldCountDisplay.textContent = consecutiveCount;
    moldCountDisplay.setAttribute('data-inherited', isInherited ? 'true' : 'false');

    // 前月金型から引き継いだ場合、data-prev-month-mold属性を設定
    if (inheritanceSource && inheritanceSource.dateIndex === -1 && inheritanceSource.shift === 'prev_month') {
        // 再利用可能金型リストからの削除は searchOtherMachinesForCount 内で実行済み
        // ここでは表示のみ更新
        displayReusableMolds();

        // 前月金型リストから該当する金型を検索してdata-prev-month-mold属性を設定
        if (typeof prevMonthMoldsOriginal !== 'undefined' && prevMonthMoldsOriginal) {
            const machineElements = document.querySelectorAll('[data-section="production_plan"][data-shift="day"] .facility-number');
            const moldMachineIndex = inheritanceSource.machineIndex;

            for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
                const mold = prevMonthMoldsOriginal[i];
                if (mold.item_name === currentItem && prevMonthMoldsStatus[i].used) {
                    // end_of_month=trueの場合: machine_nameが一致する必要がある
                    // end_of_month=falseの場合: machine_nameは空文字列なので、品番のみで一致
                    let machineMatches = false;
                    if (mold.end_of_month && moldMachineIndex >= 0 && moldMachineIndex < machineElements.length) {
                        const machineName = machineElements[moldMachineIndex].textContent.trim();
                        machineMatches = (mold.machine_name === machineName);
                    } else if (!mold.end_of_month) {
                        machineMatches = true;
                    }

                    if (machineMatches) {
                        moldCountDisplay.setAttribute('data-prev-month-mold', 'true');
                        moldCountDisplay.setAttribute('data-prev-month-count', mold.used_count.toString());
                        moldCountDisplay.setAttribute('data-prev-month-item', mold.item_name);
                        break;
                    }
                }
            }
        }
    }

    // 引き継ぎ情報を設定
    if (inheritanceSource) {
        clearPreviousInheritance(moldCountDisplay, inheritanceSource);
        if (isInherited) {
            // 他設備からの引き継ぎ: 矢印を表示
            setInheritanceInfo(moldCountDisplay, dateIndex, shift, machineIndex, currentItem, inheritanceSource);
        } else {
            // 同一設備での継続: 矢印は表示しないが、引き継ぎ元にtargetを設定
            // 【修正7改良】引き継ぎ元に既に別の設備への参照がある場合、その設備の引き継ぎをクリア
            // これにより、同一設備での継続が優先される
            const sourceDisplay = moldCountDisplayCache[inheritanceSource.shift]?.[inheritanceSource.dateIndex]?.[inheritanceSource.machineIndex];
            if (sourceDisplay) {
                const existingTargetStr = sourceDisplay.getAttribute('data-mold-inheritance-target');
                if (existingTargetStr) {
                    try {
                        const existingTarget = JSON.parse(existingTargetStr);
                        // 既存のターゲットが自分でない場合、その設備の引き継ぎを解除
                        if (!(existingTarget.targetDateIndex === dateIndex &&
                            existingTarget.targetShift === shift &&
                            existingTarget.targetMachineIndex === machineIndex)) {

                            // 引き継ぎ元の参照を完全に削除してから、新しい参照を設定
                            // 1. まず、引き継ぎ元から既存のターゲット（#1）への参照を削除
                            sourceDisplay.removeAttribute('data-mold-inheritance-target');

                            // 2. 既存のターゲット（#1）の引き継ぎ情報をクリア
                            const existingTargetDisplay = moldCountDisplayCache[existingTarget.targetShift]?.[existingTarget.targetDateIndex]?.[existingTarget.targetMachineIndex];
                            if (existingTargetDisplay) {
                                clearInheritanceInfo(existingTargetDisplay);
                            }

                            // 3. 現在の設備（#3）の引き継ぎ元への新しい参照を設定
                            setInheritanceTarget(inheritanceSource, dateIndex, shift, machineIndex, currentItem);

                            // 4. 既存のターゲット（#1）を再計算
                            // この時点で、引き継ぎ元には現在の設備（#3）への参照のみが設定されているため、
                            // #1は引き継ぎ元から引き継げず、他の金型を探すかcount=1になる
                            if (existingTargetDisplay) {
                                updateMoldCount(existingTarget.targetDateIndex, existingTarget.targetShift, existingTarget.targetMachineIndex);
                            }

                            // 引き継ぎ情報はクリア（矢印を表示しない）
                            clearInheritanceInfo(moldCountDisplay);
                            return; // ここで終了（setInheritanceTargetは既に実行済み）
                        }
                    } catch (e) {
                        // JSON解析エラーは無視
                    }
                }
            }

            setInheritanceTarget(inheritanceSource, dateIndex, shift, machineIndex, currentItem);

            // 同一設備継続でも、引き継ぎ先に引き継ぎ元の情報を記録（矢印は表示しない）
            // これにより、引き継ぎ先が変更された時に引き継ぎ元の参照をクリアできる
            const inheritanceInfo = JSON.stringify({
                sourceDateIndex: inheritanceSource.dateIndex,
                sourceShift: inheritanceSource.shift,
                sourceMachineIndex: inheritanceSource.machineIndex,
                itemName: currentItem
            });
            moldCountDisplay.setAttribute('data-mold-inheritance', inheritanceInfo);
            // ただし、data-mold-inheritance-arrowは設定しない（矢印を表示しない）
            moldCountDisplay.removeAttribute('data-mold-inheritance-arrow');
        }
    } else {
        clearInheritanceInfo(moldCountDisplay);
    }

    // 手動設定フラグをクリア（自動計算に戻す）
    moldCountDisplay.removeAttribute('data-manual-override');
    moldCountDisplay.removeAttribute('data-manual-value');

    // 金型交換閾値になった場合、この品番の後続の全ての直にリセット情報を設定して再計算
    if (consecutiveCount % MOLD_CHANGE_THRESHOLD === 0 && consecutiveCount > 0) {
        // リセット情報をJSON形式で保存（どこで6になったか）
        const resetInfo = JSON.stringify({
            dateIndex: dateIndex,
            shift: shift,
            machineIndex: machineIndex,
            itemName: currentItem
        });
        moldCountDisplay.setAttribute('data-reset-info', resetInfo);

        // 前月金型を使用している場合、消費済みにマーク
        const cellKey = `${dateIndex}-${shift}-${machineIndex}`;
        checkAndMarkPrevMonthMoldExhausted(cellKey, consecutiveCount);

        setResetFlagForItemAndRecalculate(dateIndex, shift, currentItem);
    } else {
        moldCountDisplay.removeAttribute('data-reset-info');
    }
}

// 指定した品番の後続の全ての直にリセット情報を設定して再計算
function setResetFlagForItemAndRecalculate(fromDateIndex, fromShift, itemName) {
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    let currentDateIndex = fromDateIndex;
    let currentShift = fromShift;

    // リセット情報をJSON形式で作成
    const resetInfo = JSON.stringify({
        dateIndex: fromDateIndex,
        shift: fromShift,
        itemName: itemName
    });

    // 次の直から開始
    const next = moveToNextShift(currentDateIndex, currentShift);
    currentDateIndex = next.dateIndex;
    currentShift = next.shift;

    // まず全てのリセット情報を設定
    let resetDateIndex = currentDateIndex;
    let resetShift = currentShift;
    while (resetDateIndex < dateCount) {
        for (let m = 0; m < totalMachines; m++) {
            // キャッシュから取得
            const select = selectElementCache[resetShift]?.[resetDateIndex]?.[m];
            if (select && select.value === itemName) {
                const moldCountDisplay = moldCountDisplayCache[resetShift]?.[resetDateIndex]?.[m];
                if (moldCountDisplay) {
                    moldCountDisplay.setAttribute('data-reset-info', resetInfo);
                }
            }
        }

        // 次の直に移動
        const next = moveToNextShift(resetDateIndex, resetShift);
        resetDateIndex = next.dateIndex;
        resetShift = next.shift;
    }

    // 次に全ての該当する直を再計算
    while (currentDateIndex < dateCount) {
        for (let m = 0; m < totalMachines; m++) {
            // キャッシュから取得
            const select = selectElementCache[currentShift]?.[currentDateIndex]?.[m];
            if (select && select.value === itemName) {
                const moldCountDisplay = moldCountDisplayCache[currentShift]?.[currentDateIndex]?.[m];
                if (moldCountDisplay) {
                    // 再計算（リセット情報を考慮）
                    const countResult = getConsecutiveShiftCount(currentDateIndex, currentShift, m, itemName);
                    moldCountDisplay.textContent = countResult.count;
                    moldCountDisplay.setAttribute('data-inherited', countResult.inherited ? 'true' : 'false');
                }
            }
        }

        // 次の直に移動
        const next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;
    }
}

// 引き継ぎの連鎖を再帰的にクリアする関数
// 引き継ぎ元 → 引き継ぎ先 → さらに先... という連鎖をすべてクリア
function clearInheritanceChain(moldCountDisplay) {
    if (!moldCountDisplay) return;

    // この設備が引き継ぎ元として参照している先を取得
    const targetStr = moldCountDisplay.getAttribute('data-mold-inheritance-target');

    if (targetStr) {
        try {
            const target = JSON.parse(targetStr);
            const targetDisplay = moldCountDisplayCache[target.targetShift]?.[target.targetDateIndex]?.[target.targetMachineIndex];

            if (targetDisplay) {
                // 先に引き継ぎ先の連鎖をクリア（深さ優先）
                clearInheritanceChain(targetDisplay);

                // 引き継ぎ先の引き継ぎ情報をクリア
                clearInheritanceInfo(targetDisplay);
            }
        } catch (e) {
            // JSON解析エラーは無視
        }
    }

    // この設備の引き継ぎ元参照をクリア
    moldCountDisplay.removeAttribute('data-mold-inheritance-target');
}

// 全設備の古い引き継ぎ参照をクリアする関数
// 品番が変更された設備への参照で、品番が一致しない場合はクリア
function clearStaleInheritanceReferences(targetDateIndex, targetShift, targetMachineIndex, currentItem, dateCount, totalMachines) {
    for (let shift of ['day', 'night']) {
        for (let d = 0; d < dateCount; d++) {
            for (let m = 0; m < totalMachines; m++) {
                const display = moldCountDisplayCache[shift]?.[d]?.[m];
                if (!display) continue;

                const targetStr = display.getAttribute('data-mold-inheritance-target');
                if (!targetStr) continue;

                try {
                    const target = JSON.parse(targetStr);
                    // この設備への参照をチェック
                    if (target.targetDateIndex === targetDateIndex &&
                        target.targetShift === targetShift &&
                        target.targetMachineIndex === targetMachineIndex &&
                        target.itemName !== currentItem) {
                        // 品番が変更されている場合、参照をクリア
                        display.removeAttribute('data-mold-inheritance-target');
                    }
                } catch (e) {
                    // JSON解析エラーは無視
                }
            }
        }
    }
}

// 指定した直から後の全ての直の金型使用数を更新
function updateMoldCountForMachineFromShift(startDateIndex, startShift, machineIndex, oldItem, newItem, oldMoldInfo) {
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    // 金型カウント表示要素を取得
    const moldCountDisplay = moldCountDisplayCache[startShift]?.[startDateIndex]?.[machineIndex];

    // oldItemとnewItemは引数として受け取る（呼び出し元で取得済み）

    // 品番変更時に、使いかけの金型（型数1～5）を再利用可能金型リストに追加
    if (oldItem && oldItem !== newItem && oldMoldInfo) {
        // イベントハンドラで保存した金型情報を使用
        const isPrevMonthMold = oldMoldInfo.isPrevMonthMold;
        const oldMoldCount = isPrevMonthMold ? oldMoldInfo.prevMonthCount : oldMoldInfo.currentCount;
        const isFromPrevMonth = isPrevMonthMold;


        if (isPrevMonthMold) {
        } else {
        }

        // 型数が1～5の場合、再利用可能金型リストに追加
        // ただし、強制型替え（data-manual-block="true"）の場合は追加しない（NG品などで交換が必要なため）
        const isManualBlock = moldCountDisplay.getAttribute('data-manual-block') === 'true';
        if (oldMoldCount > 0 && oldMoldCount < MOLD_CHANGE_THRESHOLD && !isManualBlock) {
            if (isFromPrevMonth) {
                // 前月金型を未使用に戻す
                if (typeof prevMonthMoldsOriginal !== 'undefined' && prevMonthMoldsOriginal) {
                    const machineElements = document.querySelectorAll('[data-section="production_plan"][data-shift="day"] .facility-number');
                    const machineName = machineElements[machineIndex] ? machineElements[machineIndex].textContent.trim() : '';

                    for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
                        const mold = prevMonthMoldsOriginal[i];
                        // end_of_month=trueの場合: machine_nameが一致する必要がある
                        // end_of_month=falseの場合: machine_nameは空文字列なので、品番のみで一致
                        const machineMatches = mold.end_of_month ? (mold.machine_name === machineName) : true;

                        if (machineMatches && mold.item_name === oldItem && prevMonthMoldsStatus[i].used) {
                            // 未使用に戻す
                            prevMonthMoldsStatus[i].used = false;
                            prevMonthMoldsStatus[i].usedBy = null;

                            // 再利用可能金型リストに追加（元の値 mold.used_count を使う）
                            const existingMoldIndex = reusableMolds.findIndex(m =>
                                m.dateIndex === -1 &&
                                m.shift === 'prev_month' &&
                                m.itemName === oldItem &&
                                m.count === mold.used_count
                            );

                            if (existingMoldIndex === -1) {
                                reusableMolds.push({
                                    id: reusableMoldIdCounter++,  // 一意ID
                                    itemName: mold.item_name,
                                    count: mold.used_count,  // oldMoldCountではなくmold.used_countを使用
                                    displayCount: mold.display_count || (mold.used_count + 1),  // 表示用のカウント
                                    dateIndex: -1,
                                    shift: 'prev_month',
                                    machineIndex: machineIndex
                                });

                                // 再利用可能金型リストの表示を更新
                                displayReusableMolds();
                            } else {
                            }
                            break;
                        }
                    }
                }
            } else {
                // 月内の金型の場合
                // 既に同じ金型がリストに存在するかチェック
                const existingMoldIndex = reusableMolds.findIndex(m =>
                    m.dateIndex === startDateIndex &&
                    m.shift === startShift &&
                    m.machineIndex === machineIndex &&
                    m.itemName === oldItem
                );

                if (existingMoldIndex === -1) {
                    // 新規追加
                    reusableMolds.push({
                        id: reusableMoldIdCounter++,  // 一意ID
                        itemName: oldItem,
                        count: oldMoldCount,
                        dateIndex: startDateIndex,
                        shift: startShift,
                        machineIndex: machineIndex
                    });

                    // 再利用可能金型リストの表示を更新
                    displayReusableMolds();
                } else {
                }
            }
        } else {
        }
    }

    // 変更された設備の引き継ぎ情報を双方向でクリア
    const changedMoldDisplay = moldCountDisplayCache[startShift]?.[startDateIndex]?.[machineIndex];
    if (changedMoldDisplay) {
        // 1. この設備が引き継ぎ元として参照している先の連鎖をクリア（前方向）
        clearInheritanceChain(changedMoldDisplay);

        // 2. この設備が引き継ぎ先の場合、引き継ぎ元の参照もクリア（後方向）
        const inheritanceStr = changedMoldDisplay.getAttribute('data-mold-inheritance');
        if (inheritanceStr) {
            try {
                const inheritance = JSON.parse(inheritanceStr);
                if (inheritance.sourceDateIndex !== -1) {
                    const sourceDisplay = moldCountDisplayCache[inheritance.sourceShift]?.[inheritance.sourceDateIndex]?.[inheritance.sourceMachineIndex];
                    if (sourceDisplay) {
                        sourceDisplay.removeAttribute('data-mold-inheritance-target');
                    }
                }
            } catch (e) {
                // JSON解析エラーは無視
            }
        }

        // 3. この設備自身の引き継ぎ情報もクリア
        clearInheritanceInfo(changedMoldDisplay);

        // 4. 全設備の引き継ぎ元参照をチェックして、この設備への参照で品番が変更されている場合はクリア
        const currentItem = selectElementCache[startShift]?.[startDateIndex]?.[machineIndex]?.value;
        clearStaleInheritanceReferences(startDateIndex, startShift, machineIndex, currentItem, dateCount, totalMachines);
    }

    // 変更された直の全設備を1回だけ計算
    // 左から右へ順番に計算することで、引き継ぎ情報が正しく伝播する
    // （以前は同じ直を3回計算していたが、1回で十分）
    // まず全設備の古い引き継ぎ情報をクリアしてから再計算
    for (let m = 0; m < totalMachines; m++) {
        const moldCountDisplay = moldCountDisplayCache[startShift]?.[startDateIndex]?.[m];
        if (moldCountDisplay) {
            clearInheritanceInfo(moldCountDisplay);
        }
    }
    // 引き継ぎ情報をクリア後、左から右に再計算
    // 前月末金型フラグは、updateMoldCount内で品番が変更された場合のみクリアされる
    for (let m = 0; m < totalMachines; m++) {
        updateMoldCount(startDateIndex, startShift, m);
    }

    // 差分計算: 影響を受ける品番のみを再計算
    recalculateAffectedItems(startDateIndex, startShift, oldItem, newItem);
}

// 影響を受ける品番のみを再計算（差分計算）
function recalculateAffectedItems(startDateIndex, startShift, oldItem, newItem) {
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    // 影響を受ける品番を収集
    const affectedItems = new Set();
    if (oldItem && oldItem !== '') affectedItems.add(oldItem);
    if (newItem && newItem !== '') affectedItems.add(newItem);

    // 影響を受ける品番がない場合は何もしない
    if (affectedItems.size === 0) {
        return;
    }

    // 次の直に移動
    let next = moveToNextShift(startDateIndex, startShift);
    let currentDateIndex = next.dateIndex;
    let currentShift = next.shift;

    // 1回のループで金型使用数の再計算と生産台数の日付収集を同時に実行
    const affectedDatesForProduction = new Set();

    while (currentDateIndex < dateCount) {
        let hasAffectedItem = false;

        for (let m = 0; m < totalMachines; m++) {
            const select = selectElementCache[currentShift]?.[currentDateIndex]?.[m];
            if (select) {
                const itemName = select.value;
                // この設備が影響を受ける品番を使用している場合
                if (affectedItems.has(itemName)) {
                    hasAffectedItem = true;
                    // 金型使用数を再計算
                    updateMoldCount(currentDateIndex, currentShift, m);
                }
            }
        }

        // 影響を受ける品番がある直の生産台数を後で再計算するため記録
        if (hasAffectedItem) {
            affectedDatesForProduction.add(`${currentDateIndex}-${currentShift}`);
        }

        // 次の直に移動
        next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;
    }

    // 影響を受ける日付の生産台数を再計算
    affectedDatesForProduction.forEach(key => {
        const [d, shift] = key.split('-');
        calculateProduction(parseInt(d), shift);
    });

    // 在庫は全品番を再計算（品番間の依存関係があるため）
    recalculateAllInventory();

    // 再利用可能金型を更新
    updateReusableMolds();

    // 引き継ぎの矢印も更新
    drawInheritanceArrows();
}

// 指定した直から後の全ての設備・全ての直の金型使用数を再計算
// 品番変更により6になる位置が変化する可能性があるため、全て再計算する
// この関数は後方互換性のため残していますが、通常はrecalculateAffectedItemsを使用します
function recalculateAllFromShift(fromDateIndex, fromShift) {
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    // 次の直に移動（ヘルパー関数を使用）
    let next = moveToNextShift(fromDateIndex, fromShift);
    let currentDateIndex = next.dateIndex;
    let currentShift = next.shift;

    // 次の直から最終直まで、全ての設備を再計算
    while (currentDateIndex < dateCount) {
        for (let m = 0; m < totalMachines; m++) {
            updateMoldCount(currentDateIndex, currentShift, m);
        }

        // 次の直に移動（ヘルパー関数を使用）
        next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;
    }

    // 全日付の生産台数を再計算
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }
    recalculateAllInventory();

    // 注: checkItemChanges()は呼ばない（型替え時間は手動で入力するため）
}

// 指定した品番を使用している全ての直を再計算（指定した直以降）
function recalculateAllOccurrencesOfItem(itemName, fromDateIndex, fromShift) {
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    let currentDateIndex = fromDateIndex;
    let currentShift = fromShift;

    // 指定した直から最終直まで走査
    while (currentDateIndex < dateCount) {
        for (let m = 0; m < totalMachines; m++) {
            // キャッシュから取得
            const select = selectElementCache[currentShift]?.[currentDateIndex]?.[m];
            if (select && select.value === itemName) {
                // この品番を使用している直を再計算
                updateMoldCount(currentDateIndex, currentShift, m);
            }
        }

        // 次の直に移動（ヘルパー関数を使用）
        const next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;
    }
}

// ========================================
// 引き継ぎ情報管理ヘルパー関数
// ========================================

// 以前の引き継ぎ元から引き継ぎ先情報をクリア
function clearPreviousInheritance(moldCountDisplay, newInheritanceSource) {
    const previousInheritanceStr = moldCountDisplay.getAttribute('data-mold-inheritance');
    if (!previousInheritanceStr) return;

    try {
        const previousInheritance = JSON.parse(previousInheritanceStr);
        // 以前の引き継ぎ元が現在と異なる場合のみクリア
        if (previousInheritance.sourceDateIndex !== newInheritanceSource.dateIndex ||
            previousInheritance.sourceShift !== newInheritanceSource.shift ||
            previousInheritance.sourceMachineIndex !== newInheritanceSource.machineIndex) {

            // 前月データからの引き継ぎ（dateIndex: -1）でない場合のみDOM要素を検索
            if (previousInheritance.sourceDateIndex !== -1) {
                // キャッシュから取得
                const prevSourceDisplay = moldCountDisplayCache[previousInheritance.sourceShift]?.[previousInheritance.sourceDateIndex]?.[previousInheritance.sourceMachineIndex];
                if (prevSourceDisplay) {
                    prevSourceDisplay.removeAttribute('data-mold-inheritance-target');
                }
            }
        }
    } catch (e) {
        // JSON解析エラーは無視
    }
}

// 引き継ぎ情報を設定（双方向）
// 引き継ぎ元に「引き継ぎ先」のみを記録（矢印は表示しない）
function setInheritanceTarget(inheritanceSource, dateIndex, shift, machineIndex, itemName) {
    // 前月データからの引き継ぎ（dateIndex: -1）の場合は記録しない
    if (inheritanceSource.dateIndex !== -1) {
        const sourceDisplay = moldCountDisplayCache[inheritanceSource.shift]?.[inheritanceSource.dateIndex]?.[inheritanceSource.machineIndex];
        if (sourceDisplay) {
            const inheritanceTarget = JSON.stringify({
                targetDateIndex: dateIndex,
                targetShift: shift,
                targetMachineIndex: machineIndex,
                itemName: itemName
            });
            sourceDisplay.setAttribute('data-mold-inheritance-target', inheritanceTarget);
        }
    }
}

function setInheritanceInfo(moldCountDisplay, dateIndex, shift, machineIndex, itemName, inheritanceSource) {
    // 引き継ぎ元の情報を保存
    const inheritanceInfo = JSON.stringify({
        sourceDateIndex: inheritanceSource.dateIndex,
        sourceShift: inheritanceSource.shift,
        sourceMachineIndex: inheritanceSource.machineIndex,
        itemName: itemName
    });
    moldCountDisplay.setAttribute('data-mold-inheritance', inheritanceInfo);

    // 引き継ぎ元のセルに「引き継ぎ先」を記録
    setInheritanceTarget(inheritanceSource, dateIndex, shift, machineIndex, itemName);
}

// 引き継ぎ情報をクリア
function clearInheritanceInfo(moldCountDisplay) {
    const previousInheritanceStr = moldCountDisplay.getAttribute('data-mold-inheritance');
    if (!previousInheritanceStr) {
        moldCountDisplay.removeAttribute('data-mold-inheritance');
        return;
    }

    try {
        const previousInheritance = JSON.parse(previousInheritanceStr);
        // 前月末データからの引き継ぎ（dateIndex: -1）でない場合のみDOM要素を検索
        if (previousInheritance.sourceDateIndex !== -1) {
            // キャッシュから取得
            const prevSourceDisplay = moldCountDisplayCache[previousInheritance.sourceShift]?.[previousInheritance.sourceDateIndex]?.[previousInheritance.sourceMachineIndex];
            if (prevSourceDisplay) {
                prevSourceDisplay.removeAttribute('data-mold-inheritance-target');
            }
        }
    } catch (e) {
        // JSON解析エラーは無視
    }
    moldCountDisplay.removeAttribute('data-mold-inheritance');
}

// 指定した設備が次の直で連続生産しているかチェック
// 土日や空セルをスキップして、次の生産直が同じ品番かチェック
function isContinuousProductionInNextShift(dateIndex, shift, machineIndex, itemName) {
    return checkIfContinuousToNextShift(dateIndex, shift, machineIndex, itemName);
}

// 前月データからの引き継ぎ管理用（グローバル変数）
// 初期データを保持し、使用済みフラグで管理
let prevMonthMoldsOriginal = []; // 元データ
let prevMonthMoldsStatus = [];   // 使用状況（used: boolean, usedBy: {machineIndex, itemName}）
let cellToPrevMonthMoldIndex = {}; // セル→前月データインデックスのマッピング

// 前月金型の使用状態をマークする
function markPrevMonthMoldAsUsed(moldIndex, cellKey, dateIndex, shift, machineIndex, currentItem) {
    const status = prevMonthMoldsStatus[moldIndex];
    status.used = true;
    status.usedBy = {
        machineIndex: machineIndex,
        itemName: currentItem,
        dateIndex: dateIndex,
        shift: shift
    };
    cellToPrevMonthMoldIndex[cellKey] = moldIndex;
}

// 前月金型の使用状態をクリアする（品番変更時）
function clearPrevMonthMoldUsage(cellKey, currentItem) {
    const prevMoldIndex = cellToPrevMonthMoldIndex[cellKey];
    if (prevMoldIndex === undefined || !prevMonthMoldsStatus[prevMoldIndex]) {
        return;
    }

    const prevStatus = prevMonthMoldsStatus[prevMoldIndex];
    const prevMold = prevMonthMoldsOriginal[prevMoldIndex];

    // 品番が変わった場合のみクリア
    if (currentItem !== prevMold.item_name) {
        const [dateIndex, shift, machineIndex] = cellKey.split('-');
        if (prevStatus.usedBy &&
            prevStatus.usedBy.machineIndex === parseInt(machineIndex) &&
            prevStatus.usedBy.dateIndex === parseInt(dateIndex) &&
            prevStatus.usedBy.shift === shift) {
            prevStatus.used = false;
            prevStatus.usedBy = null;
        }
        delete cellToPrevMonthMoldIndex[cellKey];
    }
}

// 前月金型が6直完了したかチェックし、完了していれば消費済みにマーク
function checkAndMarkPrevMonthMoldExhausted(cellKey, moldCount) {
    const prevMoldIndex = cellToPrevMonthMoldIndex[cellKey];
    if (prevMoldIndex === undefined || !prevMonthMoldsStatus[prevMoldIndex]) {
        return;
    }

    // 6直完了した場合、消費済みにマーク
    if (moldCount >= MOLD_CHANGE_THRESHOLD) {
        prevMonthMoldsStatus[prevMoldIndex].exhausted = true;
    }
}

// 前月の使用可能金型数から引き継ぎをチェック
function checkPrevMonthUsableMolds(dateIndex, shift, machineIndex, currentItem) {
    if (!prevMonthMoldsOriginal || prevMonthMoldsOriginal.length === 0) {
        return null;
    }

    // 設備名を取得（生産計画セクションのday行から取得）
    const machineElements = document.querySelectorAll('[data-section="production_plan"][data-shift="day"] .facility-number');
    const totalMachines = machineElements.length;
    if (machineIndex >= totalMachines) return null;

    const machineName = machineElements[machineIndex].textContent.trim();
    const cellKey = `${dateIndex}-${shift}-${machineIndex}`;

    // まず同じ設備の金型を探す（連続生産）
    for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
        const mold = prevMonthMoldsOriginal[i];
        const status = prevMonthMoldsStatus[i];

        if (mold.item_name === currentItem && mold.machine_name === machineName) {
            // 既に使用済みの場合はスキップ（同じ設備でも2回目以降は使わない）
            if (status.used) {
                continue;
            }

            // この金型を使用済みとしてマーク
            markPrevMonthMoldAsUsed(i, cellKey, dateIndex, shift, machineIndex, currentItem);

            // 金型交換閾値の場合は1からスタート
            if (mold.used_count % MOLD_CHANGE_THRESHOLD === 0 && mold.used_count > 0) {
                return { count: 1, inherited: false, source: null };
            }

            // 同じ設備なので連続生産として扱う
            return {
                count: mold.used_count + 1,
                inherited: false,
                source: null
            };
        }
    }

    // 同じ設備に見つからなかった場合、他設備の金型を探す（引き継ぎ）
    for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
        const mold = prevMonthMoldsOriginal[i];
        const status = prevMonthMoldsStatus[i];

        if (mold.item_name === currentItem) {
            // 既に他の設備が引き継いでいるかチェック
            if (status.used) {
                continue;
            }

            // 金型交換閾値でない場合のみ引き継ぎ可能
            if (mold.used_count % MOLD_CHANGE_THRESHOLD !== 0 || mold.used_count === 0) {
                // 引き継ぎ元の設備インデックスを取得
                let sourceMachineIndex = -1;
                for (let m = 0; m < totalMachines; m++) {
                    const mName = machineElements[m].textContent.trim();
                    if (mName === mold.machine_name) {
                        sourceMachineIndex = m;
                        break;
                    }
                }

                // この金型を使用済みとしてマーク
                markPrevMonthMoldAsUsed(i, cellKey, dateIndex, shift, machineIndex, currentItem);

                // 他設備からの引き継ぎ
                return {
                    count: mold.used_count + 1,
                    inherited: true,
                    source: {
                        dateIndex: -1, // 前月データを示す特殊値
                        shift: 'prev_month',
                        machineIndex: sourceMachineIndex
                    }
                };
            }
        }
    }

    return null;
}

// ========================================
// 品番変更チェック（金型交換時間の自動設定）
// ========================================
function checkItemChanges() {
    const startTime = performance.now();

    // キャッシュが未構築の場合は構築
    if (!vehicleSelectCache || !moldChangeInputCache || !selectContainerCache) {
        buildDOMCache();
    }

    // 型替えが必要な直をトラッキング
    const shouldHaveChangeover = new Set();

    // 全ての生産計画selectを走査（キャッシュから）
    vehicleSelectCache.forEach(select => {
        const currentItem = select.value;
        const dateIndex = parseInt(select.dataset.dateIndex);
        const shift = select.dataset.shift;
        const machineIndex = parseInt(select.dataset.machineIndex);

        // 現在の直で品番が選択されていない場合はスキップ
        if (!currentItem) {
            return;
        }

        let shouldHighlight = false;

        // 品番変更チェック: 現在の直と次の直、または前の直を比較
        // ヘルパー関数を使用して次の稼働している直を取得
        const nextSelect = getNextWorkingShift(dateIndex, shift, machineIndex);
        const prevSelect = getPrevWorkingShift(dateIndex, shift, machineIndex);

        // 次の直が存在し、品番が異なる場合
        // ただし、次の直が空でない場合のみ（次の直が空の場合は型替え不要）
        if (nextSelect && nextSelect.value && nextSelect.value.trim() !== '' && currentItem !== nextSelect.value) {
            shouldHighlight = true;
        }

        // 日勤の場合、前の夜勤との品番変更もチェック
        // ただし、前の夜勤が空でない場合のみ（前の夜勤が空の場合は型替え不要）
        if (shift === 'day' && prevSelect && prevSelect.value && prevSelect.value.trim() !== '' && currentItem !== prevSelect.value) {
            shouldHighlight = true;
        }

        // 6直連続チェック
        if (is6ConsecutiveShifts(dateIndex, shift, machineIndex, currentItem)) {
            shouldHighlight = true;
        }

        // 金型カウントが6の場合、または手動ブロック(赤)の場合もチェック
        // キャッシュから取得
        const moldCountDisplay = moldCountDisplayCache[shift]?.[dateIndex]?.[machineIndex];
        const isManualBlock = moldCountDisplay && moldCountDisplay.getAttribute('data-manual-block') === 'true';
        const moldCount = moldCountDisplay ? (parseInt(moldCountDisplay.textContent) || 0) : 0;

        if (shouldHighlight || isManualBlock || (moldCount % MOLD_CHANGE_THRESHOLD === 0 && moldCount > 0)) {
            const container = select.closest('.select-container');
            if (container) {
                container.classList.add('item-changed');
            }

            // この直は型替えが必要とマーク
            const key = `${shift}-${dateIndex}-${machineIndex}`;
            shouldHaveChangeover.add(key);

            // 金型交換時間を設定
            const moldChangeInput = getInputElement(
                `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
            );

            if (moldChangeInput && moldChangeInput.style.display !== 'none') {
                moldChangeInput.value = changeoverTime;
            }
        }
    });

    // 型替えが不要な直の入力値を0にリセット
    moldChangeInputCache.forEach((input, key) => {
        if (input.style.display !== 'none' && !shouldHaveChangeover.has(key)) {
            // この直は型替え不要なので0に設定
            const currentValue = parseInt(input.value) || 0;
            if (currentValue > 0) {
                input.value = 0;
            }
        }
    });

    // 全ての日付・シフトの生産数を再計算（金型交換時間が変更されたため）
    const dateCount = domConstantCache.dateCount;
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }

    // 引き継ぎの矢印も更新
    drawInheritanceArrows();
}

// ========================================
// 品番変更ハイライト + 型替え時間自動設定（手動操作時・自動生成後）
// ========================================
function applyItemChangeHighlights() {
    // キャッシュが未構築の場合は構築
    if (!vehicleSelectCache || !moldChangeInputCache || !selectContainerCache) {
        buildDOMCache();
    }

    // 全てのselect-containerから品番変更クラスを削除
    selectContainerCache.forEach(container => {
        container.classList.remove('item-changed');
    });

    // 型替えが必要な直をトラッキング
    const shouldSetChangeover = new Set();

    // 全ての生産計画selectを走査（キャッシュから）
    vehicleSelectCache.forEach(select => {
        const item = select.value;
        const shift = select.dataset.shift;
        const dateIndex = parseInt(select.dataset.dateIndex);
        const machineIndex = parseInt(select.dataset.machineIndex);
        const key = `${shift}-${dateIndex}-${machineIndex}`;

        // 空の場合
        if (!item || item.trim() === '') {
            // 型替え時間をクリア
            const moldChangeInput = moldChangeInputCache.get(key);
            if (moldChangeInput) {
                moldChangeInput.value = 0;
            }
            return;
        }

        // mold_countを取得
        // キャッシュから取得
        const moldCountDisplay = moldCountDisplayCache[shift]?.[dateIndex]?.[machineIndex];
        const moldCount = moldCountDisplay ? (parseInt(moldCountDisplay.textContent) || 0) : 0;

        // 条件1: mold_count=6の場合は型替え
        if (moldCount === 6) {
            shouldSetChangeover.add(key);
            return;
        }

        // 条件2: 次の直で品番が異なる場合
        // ヘルパー関数を使用して次の稼働している直を取得
        const nextSelect = getNextWorkingShift(dateIndex, shift, machineIndex);

        // 次の直で品番が異なる場合は型替え
        if (nextSelect && nextSelect.value !== item) {
            shouldSetChangeover.add(key);
        }
    });

    // 全てのセルに対して型替え時間を設定・クリア + ハイライトを適用
    moldChangeInputCache.forEach((moldChangeInput, key) => {
        if (shouldSetChangeover.has(key)) {
            // 型替え時間を設定
            moldChangeInput.value = changeoverTime;

            // ハイライト
            const select = vehicleSelectCache.get(key);
            if (select) {
                const container = select.closest('.select-container');
                if (container) {
                    container.classList.add('item-changed');
                }
            }

            // 夜勤の型替えの場合、残業時間を0にしてdisabledにする
            const [shift, dateIndex, machineIndex] = key.split('-');
            if (shift === 'night') {
                const overtimeInput = document.querySelector(
                    `.overtime-input[data-shift="night"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
                );
                if (overtimeInput && overtimeInput.style.display !== 'none') {
                    overtimeInput.value = 0;
                    overtimeInput.disabled = true;
                    overtimeInput.style.backgroundColor = '#f0f0f0';
                }
            }
        } else {
            // 型替え条件に該当しない場合は型替え時間をクリア
            moldChangeInput.value = 0;

            // 夜勤の残業inputのdisabledを解除
            const [shift, dateIndex, machineIndex] = key.split('-');
            if (shift === 'night') {
                const overtimeInput = document.querySelector(
                    `.overtime-input[data-shift="night"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
                );
                if (overtimeInput) {
                    overtimeInput.disabled = false;
                    overtimeInput.style.backgroundColor = '';
                }
            }
        }
    });

    // 金型交換時間が変更されたため、全日付の生産数を再計算
    const dateCount = domConstantCache.dateCount;
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }
    // 在庫も再計算
    recalculateAllInventory();

    // 再利用可能金型を更新
    updateReusableMolds();

    // 引き継ぎの矢印も更新
    drawInheritanceArrows();
}

// 6直連続チェック関数（6の倍数直目でハイライト）
function is6ConsecutiveShifts(dateIndex, shift, machineIndex, currentItem) {
    if (!currentItem) return false;

    // 前の直から連続して同じ品番を作っている直数をカウント
    const result = getConsecutiveShiftCount(dateIndex, shift, machineIndex, currentItem);
    const consecutiveCount = result.count;

    // 6の倍数直目（6, 12, 18, 24...）でハイライト
    // 品番が変更されるとカウントは自動的にリセットされる
    return consecutiveCount > 0 && consecutiveCount % MOLD_CHANGE_THRESHOLD === 0;
}

// 金型使用数を取得（引き継ぎ情報も含む）
// 戻り値: { count: 数値, inherited: boolean, source: {dateIndex, shift, machineIndex} or null }
function getConsecutiveShiftCountWithSource(dateIndex, shift, machineIndex, currentItem) {
    const result = getConsecutiveShiftCount(dateIndex, shift, machineIndex, currentItem);
    return result;
}

// 品番ごとの累積使用直数をカウント（自身を含む）
// 【仕様】
// - 同一設備で連続生産: 前回のカウント+1を継続
// - 同一設備で品番変更後に再使用: 他設備から引き継ぎ（6未満なら継続、6の倍数なら1から）
// - 他設備からの引き継ぎ: 最後に使用された金型カウントを探して継続
// - 引き継ぎは1箇所のみ: すでに他の設備が引き継いでいる場合は引き継ぎ不可
// 戻り値: { count: 数値, inherited: boolean, source: {dateIndex, shift, machineIndex} or null }
function getConsecutiveShiftCount(dateIndex, shift, machineIndex, currentItem) {
    if (!currentItem) return { count: 0, inherited: false, source: null };

    let count = 1; // デフォルトは1からスタート
    let inherited = false;
    let inheritanceSource = null; // 引き継ぎ元の情報
    let searchDateIndex = dateIndex;
    let searchShift = shift;

    // まず同一設備で直前に同じ品番があるかチェック
    // 前の直を探す（土日休出や休日をスキップする可能性を考慮して最大30直前まで探す）
    let prevSelectSameMachine = null;
    let prevSearchDateIndex = dateIndex;
    let prevSearchShift = shift;

    for (let offset = 1; offset <= 30; offset++) {
        // 前の直に移動（リファクタリング）
        const prev = moveToPrevShift(prevSearchDateIndex, prevSearchShift);
        prevSearchDateIndex = prev.dateIndex;
        prevSearchShift = prev.shift;

        // 範囲外になったら終了
        if (prevSearchDateIndex < 0) break;

        // キャッシュから取得
        const candidateSelect = selectElementCache[prevSearchShift]?.[prevSearchDateIndex]?.[machineIndex];

        // selectが存在し、かつ品番が入っている場合（または存在して空の場合はスキップ）
        if (candidateSelect) {
            const candidateValue = candidateSelect.value || '';
            if (candidateValue.trim() !== '') {
                // 品番が入っている直を見つけた
                prevSelectSameMachine = candidateSelect;
                searchDateIndex = prevSearchDateIndex;
                searchShift = prevSearchShift;
                break;
            }
            // 品番が空の場合はさらに前を探す（continue）
        }
    }

    // 前の直が見つかった場合
    if (prevSelectSameMachine) {
        const prevItemSameMachine = prevSelectSameMachine.value || null;

        // 同一設備で直前が同じ品番の場合のみ、カウント継続
        if (prevItemSameMachine === currentItem) {
            // キャッシュから取得
            const prevMoldCountDisplay = moldCountDisplayCache[searchShift]?.[searchDateIndex]?.[machineIndex];

            if (prevMoldCountDisplay) {
                const prevMoldCount = parseInt(prevMoldCountDisplay.textContent) || 0;

                // prevMoldCountが0の場合はスキップ（textContentが空または無効）
                if (prevMoldCount === 0) {
                    // 他の設備や過去の直から引き継ぎを探す
                    const inheritanceResult = searchOtherMachinesForCount(dateIndex, shift, machineIndex, currentItem);
                    return {
                        count: inheritanceResult.count,
                        inherited: inheritanceResult.count > 1,
                        source: inheritanceResult.source
                    };
                }
                const isManualBlock = prevMoldCountDisplay.getAttribute('data-manual-block') === 'true';

                // 手動ブロックされている場合は1からスタート
                if (isManualBlock) {
                    return { count: 1, inherited: false, source: null };
                }

                // リセット情報をチェック（6になった地点の情報）
                const resetInfoStr = prevMoldCountDisplay.getAttribute('data-reset-info');
                if (resetInfoStr) {
                    try {
                        const resetInfo = JSON.parse(resetInfoStr);
                        // リセット情報が現在の直の直前の直を指している場合のみリセット
                        // （つまり、前の直で6になった場合）
                        if (resetInfo.dateIndex === searchDateIndex &&
                            resetInfo.shift === searchShift &&
                            resetInfo.itemName === currentItem) {
                            // 同一品番の6未満の金型を探す（他設備から引き継ぎ）
                            const inheritanceResult = searchOtherMachinesForCount(dateIndex, shift, machineIndex, currentItem);
                            if (inheritanceResult.count > 1) {
                                return {
                                    count: inheritanceResult.count,
                                    inherited: true,
                                    source: inheritanceResult.source
                                };
                            } else {
                                // 途中交換金型が見つからなければ1からスタート
                                return { count: 1, inherited: false, source: null };
                            }
                        }
                    } catch (e) {
                        // JSON解析エラーは無視
                    }
                }

                // 金型交換閾値（交換済み）の場合、同一品番での途中交換金型を探す
                if (prevMoldCount % MOLD_CHANGE_THRESHOLD === 0 && prevMoldCount > 0) {
                    // 同一品番の6未満の金型を探す（他設備から引き継ぎ）
                    const inheritanceResult = searchOtherMachinesForCount(dateIndex, shift, machineIndex, currentItem);
                    if (inheritanceResult.count > 1) {
                        return {
                            count: inheritanceResult.count,
                            inherited: true,
                            source: inheritanceResult.source
                        };
                    } else {
                        // 途中交換金型が見つからなければ1からスタート
                        return { count: 1, inherited: false, source: null };
                    }
                }

                // 続きからカウント（同一設備での連続生産なので引き継ぎではない）
                // 手動設定値も含めて引き継ぐ
                // 注意: 同一設備での連続生産だが、再利用可能金型リストから除外するため
                // sourceを返して引き継ぎ情報を設定する
                return {
                    count: prevMoldCount + 1,
                    inherited: false,
                    source: {
                        dateIndex: searchDateIndex,
                        shift: searchShift,
                        machineIndex: machineIndex
                    }
                };
            }
        }

        // 同一設備で直前が異なる品番、または品番がない場合
        // → 他の設備や過去の直から引き継ぎを探す
        const inheritanceResult = searchOtherMachinesForCount(dateIndex, shift, machineIndex, currentItem);
        if (inheritanceResult.count > 1) {
            return {
                count: inheritanceResult.count,
                inherited: true,
                source: inheritanceResult.source
            };
        } else {
            return { count: 1, inherited: false, source: null };
        }
    }

    // 同一設備に前の直がない場合（月初など）
    // → 他設備からの引き継ぎを探す
    const inheritanceResult = searchOtherMachinesForCount(dateIndex, shift, machineIndex, currentItem);
    if (inheritanceResult.count > 1) {
        return {
            count: inheritanceResult.count,
            inherited: true,
            source: inheritanceResult.source
        };
    } else {
        return { count: 1, inherited: false, source: null };
    }
}

// 他設備から金型使用数を探す
// 【仕様】
// - 同一設備で連続していない場合に、他の設備や過去の直から金型カウントを探す
// - 同一品番で6未満のカウントがあれば優先的に引き継ぐ（途中交換した型を継続使用）
// - 6の倍数のカウントしかない場合は1からスタート（型交換済み）
// - 既に他の設備が引き継いでいる場合は引き継ぎ不可（1を返す）
// - 途中交換した型（連続生産でない型）も引き継ぎ可能
// - 【重要】同じ直の他の設備からは引き継がない（同じ直では独立して1からスタート）
// - 前月末の金型も検索対象（dateIndex=0, shift='day'の場合のみ）
// 戻り値: { count: 数値, source: {dateIndex, shift, machineIndex} or null }
function searchOtherMachinesForCount(dateIndex, shift, machineIndex, currentItem) {
    const totalMachines = domConstantCache.totalMachines;

    // 【重要】まず再利用可能金型リスト（dateIndex=-1, shift='prev_month'）に該当する金型があるかチェック
    // 再利用可能金型リストに入っている金型は、一度使われて外された金型で、その時点のcountが正しい
    if (dateIndex === 0 && shift === 'night') {
    }

    const reusablePrevMonthMold = reusableMolds.find(m =>
        m.dateIndex === -1 &&
        m.shift === 'prev_month' &&
        m.itemName === currentItem &&
        m.count > 0 &&
        m.count < MOLD_CHANGE_THRESHOLD
    );

    if (reusablePrevMonthMold) {
        if (dateIndex === 0 && shift === 'night') {
        }

        // 【重要】prevMonthMoldsOriginalから該当する金型を探してused=trueにマーク
        // これにより、updateReusableMolds()が呼ばれた時に再度リストに追加されない
        for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
            const mold = prevMonthMoldsOriginal[i];
            if (mold.item_name === currentItem && mold.used_count === reusablePrevMonthMold.count && !mold.end_of_month && !prevMonthMoldsStatus[i].used) {
                const cellKey = `${dateIndex}-${shift}-${machineIndex}`;
                markPrevMonthMoldAsUsed(i, cellKey, dateIndex, shift, machineIndex, currentItem);
                if (dateIndex === 0 && shift === 'night') {
                }
                break;
            }
        }

        // 【重要】再利用可能金型リストから即座に削除（他の設備が引き継げないようにする）
        const moldIndexToRemove = reusableMolds.findIndex(m =>
            m.dateIndex === -1 &&
            m.shift === 'prev_month' &&
            m.itemName === reusablePrevMonthMold.itemName &&
            m.count === reusablePrevMonthMold.count
        );
        if (moldIndexToRemove !== -1) {
            reusableMolds.splice(moldIndexToRemove, 1);
            if (dateIndex === 0 && shift === 'night') {
            }
        }

        // 再利用可能金型リストから引き継ぐ
        return {
            count: reusablePrevMonthMold.count + 1,
            source: {
                dateIndex: -1,
                shift: 'prev_month',
                machineIndex: reusablePrevMonthMold.machineIndex
            }
        };
    }

    // 前月末の金型から引き継ぎ可能かチェック（再利用可能金型リストにない場合のみ）
    if (typeof prevMonthMoldsOriginal !== 'undefined' && prevMonthMoldsOriginal) {
        if (dateIndex === 0 && shift === 'night') {
        }
        const machineElements = document.querySelectorAll('[data-section="production_plan"][data-shift="day"] .facility-number');

        for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
            const mold = prevMonthMoldsOriginal[i];
            const status = prevMonthMoldsStatus[i];

            if (dateIndex === 0 && shift === 'night') {
            }

            // 同じ品番で、使用済みでない、消費済みでない、6未満の金型
            if (mold.item_name === currentItem && !status.used && !status.exhausted && mold.used_count > 0 && mold.used_count < MOLD_CHANGE_THRESHOLD) {
                // 設備インデックスを取得
                let moldMachineIndex = -1;
                for (let m = 0; m < machineElements.length; m++) {
                    const machineName = machineElements[m].textContent.trim();
                    if (machineName === mold.machine_name) {
                        moldMachineIndex = m;
                        break;
                    }
                }

                // 【重要】引き継ぎ可能条件の判定
                // - end_of_month=true（月末時点で設備に取り付いている）: 同じ設備でのみ引き継ぎ可能
                // - end_of_month=false（月内で途中で外された）: どの設備でも引き継ぎ可能
                const canInherit = mold.end_of_month
                    ? (moldMachineIndex === machineIndex)  // 月末取り付き金型: 同じ設備のみ
                    : true;  // 途中型替え金型: どの設備でも可

                if (canInherit) {
                    // この金型を使用済みとしてマーク
                    const cellKey = `${dateIndex}-${shift}-${machineIndex}`;
                    markPrevMonthMoldAsUsed(i, cellKey, dateIndex, shift, machineIndex, currentItem);

                    // 【重要】再利用可能金型リストから削除（初めて使用する場合）
                    // end_of_month=falseの金型は初期化時にreusableMoldsに追加されているため、
                    // 初めて使用する時にリストから削除する必要がある
                    if (!mold.end_of_month) {
                        const moldIndexToRemove = reusableMolds.findIndex(m =>
                            m.dateIndex === -1 &&
                            m.shift === 'prev_month' &&
                            m.itemName === currentItem &&
                            m.count === mold.used_count
                        );
                        if (moldIndexToRemove !== -1) {
                            reusableMolds.splice(moldIndexToRemove, 1);
                            if (dateIndex === 0 && shift === 'night') {
                            }
                        }
                    }

                    // 引き継ぎ（dateIndex=-1は前月末を示す特殊値）
                    return {
                        count: mold.used_count + 1,
                        source: {
                            dateIndex: -1,
                            shift: 'prev_month',
                            machineIndex: moldMachineIndex
                        }
                    };
                }
            }
        }
    }

    // 同一品番の6未満の金型を最優先で探す
    let closestSixMultiple = null; // 最も近い6の倍数の候補（フォールバック用）

    // 前の直から引き継ぎを探す
    let searchDateIndex = dateIndex;
    let searchShift = shift;
    let totalIterations = 0;
    let maxTotalIterations = 300;

    while (totalIterations < maxTotalIterations) {
        totalIterations++;

        // 前の直に移動（リファクタリング）
        const prev = moveToPrevShift(searchDateIndex, searchShift);
        searchDateIndex = prev.dateIndex;
        searchShift = prev.shift;

        // 範囲外の場合は終了
        if (searchDateIndex < 0) {
            break;
        }

        // この直の全設備を確認
        for (let m = 0; m < totalMachines; m++) {
            // キャッシュから取得
            const prevSelect = selectElementCache[searchShift]?.[searchDateIndex]?.[m];
            if (!prevSelect) continue;

            const prevItem = prevSelect.value || null;

            // 同じ品番が見つかった場合
            if (prevItem === currentItem) {
                // キャッシュから取得
                const prevMoldCountDisplay = moldCountDisplayCache[searchShift]?.[searchDateIndex]?.[m];

                if (prevMoldCountDisplay && prevMoldCountDisplay.textContent) {
                    const prevMoldCount = parseInt(prevMoldCountDisplay.textContent) || 0;
                    const isManualBlock = prevMoldCountDisplay.getAttribute('data-manual-block') === 'true';

                    // 手動ブロックされている場合はスキップ
                    if (isManualBlock) {
                        continue;
                    }

                    // 【重要】この設備が次の直で連続生産しているかチェック
                    // 連続生産している場合は引き継ぎ不可（連続生産が優先）
                    if (isContinuousProductionInNextShift(searchDateIndex, searchShift, m, currentItem)) {
                        continue;
                    }

                    // 既に他の設備が引き継いでいるかチェック
                    const inheritanceTargetStr = prevMoldCountDisplay.getAttribute('data-mold-inheritance-target');
                    if (inheritanceTargetStr) {
                        try {
                            const inheritanceTarget = JSON.parse(inheritanceTargetStr);
                            // 既に他の設備が引き継いでいる場合は、引き継ぎ不可
                            // ただし、引き継ぎ先が現在のセル自身の場合は引き継ぎ可（再計算の場合）
                            if (!(inheritanceTarget.targetDateIndex === dateIndex &&
                                inheritanceTarget.targetShift === shift &&
                                inheritanceTarget.targetMachineIndex === machineIndex)) {
                                // 別の設備が既に引き継いでいる
                                continue; // 次の候補を探す
                            }
                        } catch (e) {
                            // JSON解析エラーは無視
                        }
                    }

                    // リセット情報をチェック
                    const resetInfoStr = prevMoldCountDisplay.getAttribute('data-reset-info');
                    let hasResetInfo = false;
                    if (resetInfoStr) {
                        try {
                            const resetInfo = JSON.parse(resetInfoStr);
                            const resetShiftNum = resetInfo.shift === 'day' ? 0 : 1;
                            const currentShiftNum = shift === 'day' ? 0 : 1;
                            const resetPosition = resetInfo.dateIndex * 2 + resetShiftNum;
                            const currentPosition = dateIndex * 2 + currentShiftNum;

                            if (resetPosition < currentPosition && resetInfo.itemName === currentItem) {
                                hasResetInfo = true;
                            }
                        } catch (e) {
                            // JSON解析エラーは無視
                        }
                    }

                    // リセット情報がある場合はスキップ
                    if (hasResetInfo) {
                        continue;
                    }

                    // 候補を分類
                    const isSixMultiple = prevMoldCount % MOLD_CHANGE_THRESHOLD === 0 && prevMoldCount > 0;

                    if (!isSixMultiple) {
                        // 6未満の金型が見つかった場合、最優先候補として即座に返す
                        return {
                            count: prevMoldCount + 1,
                            source: {
                                dateIndex: searchDateIndex,
                                shift: searchShift,
                                machineIndex: m
                            }
                        };
                    } else if (!closestSixMultiple) {
                        // 6の倍数の場合、最初に見つかったものを記録（フォールバック用）
                        closestSixMultiple = {
                            dateIndex: searchDateIndex,
                            shift: searchShift,
                            machineIndex: m
                        };
                    }
                }
            }
        }
    }

    // 6未満の候補が見つからず、6の倍数しかない場合は1からスタート
    return { count: 1, source: null };
}

// 前の5直分の品番を取得
function getPrevious5Shifts(dateIndex, shift, machineIndex) {
    const shifts = [];
    let currentDateIndex = dateIndex;
    let currentShift = shift;

    // 機械名を取得（前月データ参照用）
    const machineNameElement = document.querySelector(
        `tr[data-machine-index="${machineIndex}"] .facility-number`
    );
    const machineName = machineNameElement ? machineNameElement.textContent.trim() : null;

    for (let i = 0; i < 5; i++) {
        // 前の直に移動（リファクタリング）
        const prev = moveToPrevShift(currentDateIndex, currentShift);
        currentDateIndex = prev.dateIndex;
        currentShift = prev.shift;

        // 範囲外（前月）の場合
        if (currentDateIndex < 0) {
            // 前月データから取得
            if (!previousMonthProductionPlans || !machineName) break;

            // 前の直のインデックス（0が一番古い、4が最新）
            // shift='day'の場合: i=0->4, i=1->3, i=2->2, i=3->1, i=4->0
            // shift='night'の場合: i=1->4, i=2->3, i=3->2, i=4->1 (i=0は当月データ)
            const prevMonthShiftIndex = (shift === 'night') ? (5 - i) : (4 - i);
            if (prevMonthShiftIndex >= 0 && prevMonthShiftIndex < previousMonthProductionPlans.length) {
                const prevMonthShift = previousMonthProductionPlans[prevMonthShiftIndex];
                const item = prevMonthShift.plans[machineName];
                if (item) {
                    shifts.push(item);
                } else {
                    break; // データがない場合は中断
                }
            } else {
                break;
            }
        } else {
            // 今月のデータから取得
            // キャッシュから取得
            const prevSelect = selectElementCache[currentShift]?.[currentDateIndex]?.[machineIndex];

            if (prevSelect && prevSelect.value) {
                shifts.push(prevSelect.value);
            } else {
                break; // selectが存在しないか値がない場合は中断
            }
        }
    }

    return shifts;
}

// ========================================
// 在庫計算
// ========================================
// 高速化のため要素をキャッシュ
let inventoryElementCache = null;

function buildInventoryElementCache() {
    const cache = {
        inventory: {},
        delivery: {},
        production: {}
    };

    // 在庫入力要素をキャッシュ
    document.querySelectorAll('.inventory-input').forEach(input => {
        const shift = input.dataset.shift;
        const item = input.dataset.item;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${item}-${dateIndex}`;
        cache.inventory[key] = input;
    });

    // 出庫入力要素をキャッシュ
    document.querySelectorAll('.delivery-input').forEach(input => {
        const shift = input.dataset.shift;
        const item = input.dataset.item;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${item}-${dateIndex}`;
        cache.delivery[key] = input;
    });

    // 生産入力要素をキャッシュ（セルではなくinputに変更）
    document.querySelectorAll('.production-input').forEach(input => {
        const shift = input.dataset.shift;
        const item = input.dataset.item;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${item}-${dateIndex}`;
        cache.production[key] = input;
    });

    return cache;
}

function calculateInventory(dateIndex, shift, itemName) {
    // キャッシュが未作成の場合は作成
    if (!inventoryElementCache) {
        inventoryElementCache = buildInventoryElementCache();
    }

    // 在庫数inputを取得
    const inventoryKey = `${shift}-${itemName}-${dateIndex}`;
    const inventoryInput = inventoryElementCache.inventory[inventoryKey];

    // 手動編集されている場合はスキップ（値を上書きしない）
    if (inventoryInput && inventoryInput.dataset.manualEdit === 'true') {
        return parseFloat(inventoryInput.value) || 0;
    }

    let previousInventory = 0;

    // 前の直の在庫を取得
    if (dateIndex === 0 && shift === 'day') {
        // 初日の日勤: 前月最終在庫
        previousInventory = previousMonthInventory[itemName] || 0;
    } else if (shift === 'day') {
        // 日勤: 前の稼働日の夜勤の在庫を探す（土日休出や休日をスキップ）
        let foundPrevInventory = false;
        for (let offset = 1; offset <= 10; offset++) {
            const prevNightKey = `night-${itemName}-${dateIndex - offset}`;
            const prevNightInventoryInput = inventoryElementCache.inventory[prevNightKey];

            // 要素が存在し、かつ値が設定されている（生産があった）場合
            if (prevNightInventoryInput && prevNightInventoryInput.value !== '') {
                previousInventory = parseFloat(prevNightInventoryInput.value) || 0;
                foundPrevInventory = true;
                break;
            }

            // 前日の日勤も確認（休出の可能性）
            const prevDayKey = `day-${itemName}-${dateIndex - offset}`;
            const prevDayInventoryInput = inventoryElementCache.inventory[prevDayKey];
            if (prevDayInventoryInput && prevDayInventoryInput.value !== '') {
                previousInventory = parseFloat(prevDayInventoryInput.value) || 0;
                foundPrevInventory = true;
                break;
            }
        }

        // 見つからない場合は前月最終在庫
        if (!foundPrevInventory) {
            previousInventory = previousMonthInventory[itemName] || 0;
        }
    } else {
        // 夜勤: その日の日勤の在庫
        const dayKey = `day-${itemName}-${dateIndex}`;
        const dayInventoryInput = inventoryElementCache.inventory[dayKey];
        previousInventory = parseFloat(dayInventoryInput?.value) || 0;
    }

    // 自身の直の出庫数を取得
    const deliveryKey = `${shift}-${itemName}-${dateIndex}`;
    const deliveryInput = inventoryElementCache.delivery[deliveryKey];
    const currentDelivery = parseFloat(deliveryInput?.value) || 0;

    // 自身の直の生産数を取得（inputに変更）
    const productionKey = `${shift}-${itemName}-${dateIndex}`;
    const currentProductionInput = inventoryElementCache.production[productionKey];
    const currentProduction = parseFloat(currentProductionInput?.value) || 0;

    // 在庫に加算する際は不良率を考慮（良品のみ）
    const data = itemData[itemName] || {};
    const yieldRate = data.yield_rate || 1.0;
    const goodProduction = Math.floor(currentProduction * yieldRate);

    // 在庫数 = 前の直の在庫 + 自身の直の良品生産数 - 自身の直の出庫数
    const inventory = previousInventory + goodProduction - currentDelivery;

    // 在庫数inputに値を設定
    if (inventoryInput) {
        const roundedInventory = Math.round(inventory);
        inventoryInput.value = roundedInventory;

        // 在庫が負の場合は赤色にする
        if (roundedInventory < 0) {
            inventoryInput.classList.add('negative-inventory');
        } else {
            inventoryInput.classList.remove('negative-inventory');
        }
    }

    return inventory;
}

function recalculateAllInventory() {
    // 初期化中は在庫再計算をスキップ
    if (isInitializing) {
        return;
    }

    // キャッシュが未作成の場合は作成
    if (!inventoryElementCache) {
        inventoryElementCache = buildInventoryElementCache();
    }

    // 全日付数を取得（ヘッダー行の列数）
    const dateCount = domConstantCache.dateCount;

    // itemDataとpreviousMonthInventoryの品番を統合（高速化：配列で管理）
    const itemDataKeys = Object.keys(itemData);
    const prevKeys = Object.keys(previousMonthInventory);
    const allItemNamesArray = [...new Set([...itemDataKeys, ...prevKeys])];

    // 日勤→夜勤の順で計算（前の直の在庫に依存するため）
    for (let i = 0; i < dateCount; i++) {
        for (let j = 0; j < allItemNamesArray.length; j++) {
            const itemName = allItemNamesArray[j];
            calculateInventory(i, 'day', itemName);
            calculateInventory(i, 'night', itemName);
        }
    }

    // 在庫計算後に月末在庫カードをリアルタイムで更新（品番リストを渡して重複計算を削減）
    updateInventoryComparisonCard(allItemNamesArray, dateCount);

    // 行合計と溶湯計算を非同期で更新（パフォーマンス改善）
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
            calculateRowTotals();
            calculateMoltenMetalPotAndCore();
        }, { timeout: 100 });
    } else {
        setTimeout(() => {
            calculateRowTotals();
            calculateMoltenMetalPotAndCore();
        }, 50);
    }
}

// ========================================
// 生産台数計算
// ========================================
function calculateProduction(dateIndex, shift) {
    // 週末で休出がチェックされていない場合は計算しない
    const checkCells = domConstantCache.checkCells;
    const checkCell = checkCells[dateIndex];
    if (checkCell) {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        if (isWeekend && checkText !== '休出') {
            // 生産台数inputをクリア（キャッシュを使用）
            if (inventoryElementCache) {
                Object.keys(inventoryElementCache.production).forEach(key => {
                    const [cellShift, , cellDateIndex] = key.split('-');
                    if (cellShift === shift && cellDateIndex === String(dateIndex)) {
                        inventoryElementCache.production[key].value = '';
                    }
                });
            }
            return;
        }
    }

    // 稼働率を取得（統一された関数を使用）
    const operationRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
    const operationRate = operationRateInput ? (parseFloat(operationRateInput.value) || 0) / 100 : 0;

    if (operationRate === 0) return;

    // 基本稼働時間（分）- 定数を使用
    const baseTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    // その日のシフトの生産計画selectを取得
    const productionPlanSelects = document.querySelectorAll(
        `.vehicle-select[data-shift="${shift}"][data-date-index="${dateIndex}"]`
    );

    // 品番ごとに集計（機械数、計画停止時間、残業時間の合計）
    const itemStats = {};

    productionPlanSelects.forEach(select => {
        // 非表示のselectはスキップ（週末で休出がない場合など）
        const container = select.closest('.select-container');
        if (container && container.style.display === 'none') return;

        const selectedItem = select.value;
        if (!selectedItem) return;

        const machineIndex = parseInt(select.dataset.machineIndex);

        if (!itemStats[selectedItem]) {
            itemStats[selectedItem] = {
                machineCount: 0,
                totalStopTime: 0,
                totalOvertime: 0,
                totalMoldChange: 0
            };
        }

        itemStats[selectedItem].machineCount++;

        // この設備の計画停止時間を取得（統一された関数を使用）
        const stopTimeInput = getInputElement(
            `.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (stopTimeInput) {
            itemStats[selectedItem].totalStopTime += getInputValue(stopTimeInput);
        }

        // この設備の金型交換時間を取得（統一された関数を使用）
        const moldChangeInput = getInputElement(
            `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        const moldChangeTime = moldChangeInput ? getInputValue(moldChangeInput) : 0;
        if (moldChangeInput) {
            itemStats[selectedItem].totalMoldChange += moldChangeTime;
        }

        // この設備の残業時間を取得（統一された関数を使用）
        // 夜勤で型替えがある場合は残業時間を含めない
        const overtimeInput = getInputElement(
            `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (overtimeInput) {
            const hasMoldChange = shift === 'night' && moldChangeTime > 0;
            if (!hasMoldChange) {
                itemStats[selectedItem].totalOvertime += getInputValue(overtimeInput);
            }
        }
    });

    // 各品番の生産台数を計算して表示
    // 各設備ごとに計算してから合計する（バックエンドと同じ方法）
    productionPlanSelects.forEach(select => {
        // 非表示のselectはスキップ（週末で休出がない場合など）
        const container = select.closest('.select-container');
        if (container && container.style.display === 'none') return;

        const selectedItem = select.value;
        if (!selectedItem) return;

        const data = itemData[selectedItem];
        if (!data || data.tact === 0) return;

        const machineIndex = parseInt(select.dataset.machineIndex);

        // この設備の計画停止時間を取得
        const stopTimeInput = getInputElement(
            `.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        const stopTime = stopTimeInput ? getInputValue(stopTimeInput) : 0;

        // この設備の金型交換時間を取得
        const moldChangeInput = getInputElement(
            `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        const moldChangeTime = moldChangeInput ? getInputValue(moldChangeInput) : 0;

        // この設備の残業時間を取得
        // 夜勤で型替えがある場合は残業時間を含めない
        const overtimeInput = getInputElement(
            `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        let overtime = 0;
        if (overtimeInput) {
            const hasMoldChange = shift === 'night' && moldChangeTime > 0;
            if (!hasMoldChange) {
                overtime = getInputValue(overtimeInput);
            }
        }

        // この設備の稼働時間 = 基本稼働時間 - 計画停止時間 - 金型交換時間 + 残業時間
        const workingTime = Math.max(0, baseTime - stopTime - moldChangeTime + overtime);

        // この設備の生産台数 = (稼働時間 / タクト) × 稼働率（不良品も含む数量）
        const production = Math.floor((workingTime / data.tact) * operationRate);

        // 品番ごとに合計
        if (!itemStats[selectedItem].totalProduction) {
            itemStats[selectedItem].totalProduction = 0;
        }
        itemStats[selectedItem].totalProduction += production;
    });

    // 各品番の生産台数をinputに設定
    Object.keys(itemStats).forEach(itemName => {
        const stats = itemStats[itemName];
        const totalProduction = stats.totalProduction || 0;

        // 生産台数inputに値を設定（キャッシュを使用）
        const productionKey = `${shift}-${itemName}-${dateIndex}`;
        const productionInput = inventoryElementCache?.production[productionKey];
        if (productionInput) {
            productionInput.value = totalProduction;
        }
    });

    // 選択されていない品番のinputは空にする（キャッシュを使用）
    if (inventoryElementCache) {
        Object.keys(inventoryElementCache.production).forEach(key => {
            const [cellShift, cellItem, cellDateIndex] = key.split('-');
            if (cellShift === shift && cellDateIndex === String(dateIndex)) {
                if (!itemStats[cellItem]) {
                    inventoryElementCache.production[key].value = '';
                }
            }
        });
    }

    // 初期化中でない場合のみ在庫数を再計算
    if (!isInitializing) {
        recalculateAllInventory();
    }
}

// ========================================
// 金型使用数の手動編集モーダル
// ========================================
let moldCountEditModal = null;

function createMoldCountEditModal() {
    if (moldCountEditModal) {
        return moldCountEditModal;
    }

    // モーダルHTML作成
    const modalHtml = `
        <div class="modal fade" id="moldCountEditModal" tabindex="-1" aria-labelledby="moldCountEditModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="moldCountEditModalLabel">金型使用数の変更</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label fw-bold">日付:</label>
                            <span id="modal-date" class="ms-2"></span>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">時間帯:</label>
                            <span id="modal-shift" class="ms-2"></span>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">設備名:</label>
                            <span id="modal-machine" class="ms-2"></span>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">品番:</label>
                            <span id="modal-item" class="ms-2"></span>
                        </div>
                        <div class="mb-3">
                            <label for="modal-mold-count-input" class="form-label fw-bold">金型使用数:</label>
                            <input type="number" class="form-control" id="modal-mold-count-input" min="1" max="99" value="1">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">キャンセル</button>
                        <button type="button" class="btn btn-primary" id="modal-save-btn">保存</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // モーダルをbodyに追加
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Bootstrapモーダルのインスタンスを取得
    const modalElement = document.getElementById('moldCountEditModal');
    moldCountEditModal = new bootstrap.Modal(modalElement);

    return moldCountEditModal;
}

function showMoldCountEditModal(moldCountDisplay) {
    const dateIndex = parseInt(moldCountDisplay.getAttribute('data-date-index'));
    const shift = moldCountDisplay.getAttribute('data-shift');
    const machineIndex = parseInt(moldCountDisplay.getAttribute('data-machine-index'));

    // 日付を取得
    const dateHeaders = document.querySelectorAll('thead tr:nth-child(2) th');
    const dateText = dateHeaders[dateIndex] ? dateHeaders[dateIndex].textContent.trim() : '';

    // 時間帯
    const shiftText = shift === 'day' ? '日勤' : '夜勤';

    // 設備名を取得
    const machineRow = document.querySelector(`tr[data-machine-index="${machineIndex}"]`);
    const machineNameElement = machineRow ? machineRow.querySelector('.facility-number') : null;
    const machineName = machineNameElement ? machineNameElement.textContent.trim() : '';

    // 品番を取得
    const select = document.querySelector(
        `.vehicle-select[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
    );
    const itemName = select ? select.value : '';

    // 現在の金型使用数を取得
    const currentValue = parseInt(moldCountDisplay.textContent) || 1;

    // モーダルを作成または取得
    const modal = createMoldCountEditModal();

    // モーダルの内容を設定
    document.getElementById('modal-date').textContent = dateText;
    document.getElementById('modal-shift').textContent = shiftText;
    document.getElementById('modal-machine').textContent = machineName;
    document.getElementById('modal-item').textContent = itemName;
    document.getElementById('modal-mold-count-input').value = currentValue;

    // 保存ボタンのイベントリスナーを設定
    const saveBtn = document.getElementById('modal-save-btn');
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener('click', function () {
        const newValue = parseInt(document.getElementById('modal-mold-count-input').value);
        if (newValue >= 1 && newValue <= 99) {
            // 金型使用数を更新
            moldCountDisplay.textContent = newValue;
            moldCountDisplay.setAttribute('data-manual-override', 'true');
            moldCountDisplay.setAttribute('data-manual-value', newValue);

            // モーダルを閉じる
            modal.hide();

            // この直以降の全ての設備・全ての直を再計算
            // （手動設定により6の位置が変化する可能性があるため）
            recalculateAllFromShift(dateIndex, shift);

            // 型替えハイライトと残業制御を更新
            applyItemChangeHighlights();
        } else {
            showToast('error', '1から99の間の値を入力してください');
        }
    });

    // モーダルを表示
    modal.show();
}

// ========================================
// 金型使用数の手動ブロック機能
// ========================================
function toggleMoldCountManualBlock(moldCountDisplay) {
    const dateIndex = parseInt(moldCountDisplay.getAttribute('data-date-index'));
    const shift = moldCountDisplay.getAttribute('data-shift');
    const machineIndex = parseInt(moldCountDisplay.getAttribute('data-machine-index'));

    // 現在の状態を取得
    const isManualBlock = moldCountDisplay.getAttribute('data-manual-block') === 'true';

    // トグル（赤 ⇔ 通常）
    if (isManualBlock) {
        // 赤を解除
        moldCountDisplay.setAttribute('data-manual-block', 'false');
        moldCountDisplay.classList.remove('manual-block');
    } else {
        // 赤にする（6の位置と同じ扱い = 次から1になる）
        moldCountDisplay.setAttribute('data-manual-block', 'true');
        moldCountDisplay.classList.add('manual-block');
    }

    // この設備と品番を更新
    updateMoldCount(dateIndex, shift, machineIndex);

    // この直以降の全ての設備・全ての直を再計算
    // （手動ブロックにより6の位置が変化する可能性があるため）
    recalculateAllFromShift(dateIndex, shift);

    // 型替えハイライトと残業制御を更新
    applyItemChangeHighlights();
}

// 指定した直から後の全ての直の金型使用数を再計算
function updateMoldCountFromShiftOnward(startDateIndex, startShift, machineIndex) {
    const dateCount = domConstantCache.dateCount;

    // 次の直に移動（ヘルパー関数を使用）
    let next = moveToNextShift(startDateIndex, startShift);
    let currentDateIndex = next.dateIndex;
    let currentShift = next.shift;

    // 次の直から最終直まで更新
    while (currentDateIndex < dateCount) {
        updateMoldCount(currentDateIndex, currentShift, machineIndex);

        // 次の直に移動（ヘルパー関数を使用）
        next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;
    }

    // 品番変更をチェック（金型交換時間の更新のため）
    checkItemChanges();
}

// ========================================
// イベントリスナー設定
// ========================================
function setupEventListeners() {
    // デバウンスされた再計算関数を作成
    const debouncedRecalculateInventory = debounce(recalculateAllInventory, 300);
    const debouncedCalculateProduction = debounce(function (dateIndex, shift) {
        calculateProduction(dateIndex, shift);
    }, 200);

    // 金型使用数のダブルクリックイベント（手動ブロック）
    document.querySelectorAll('.mold-count-display').forEach(display => {
        display.addEventListener('dblclick', function () {
            toggleMoldCountManualBlock(this);
        });

        // 右クリックイベント（数値編集モーダル）
        display.addEventListener('contextmenu', function (event) {
            event.preventDefault(); // デフォルトの右クリックメニューを無効化
            showMoldCountEditModal(this);
        });
    });

    // 稼働率入力の変更を監視
    document.querySelectorAll('.operation-rate-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            calculateProduction(dateIndex, 'day');
            calculateProduction(dateIndex, 'night');
        });
    });

    // 計画停止入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.stop-time-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            debouncedCalculateProduction(dateIndex, shift);
            debouncedCalculateRowTotals();
        });
    });

    // 残業入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.overtime-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            debouncedCalculateProduction(dateIndex, shift);
            debouncedCalculateRowTotals();
        });
    });

    // 金型交換入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.mold-change-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            debouncedCalculateProduction(dateIndex, shift);
            debouncedCalculateRowTotals();
        });
    });

    // 生産数入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.production-input').forEach(input => {
        input.addEventListener('input', function () {
            debouncedRecalculateInventory();
            debouncedCalculateRowTotals();
        });
    });

    // 出庫数入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.delivery-input').forEach(input => {
        input.addEventListener('input', function () {
            debouncedRecalculateInventory();
            debouncedCalculateRowTotals();
        });
    });

    // 在庫数入力の手動変更を監視（フラグ設定のみ）
    document.querySelectorAll('.inventory-input').forEach(input => {
        input.addEventListener('input', function () {
            // 手動修正フラグを設定（自動計算での上書きを防ぐ）
            this.dataset.manualEdit = 'true';
            debouncedCalculateRowTotals();
        });
    });
}

// ========================================
// キャッシュ一括構築
// ========================================
function buildAllCaches() {
    // 同期キャッシュ（即座に必要）
    inventoryElementCache = buildInventoryElementCache();
    inventoryCardCache = buildInventoryCardCache();
    overtimeInputCache = buildOvertimeInputCache();

    // 非同期キャッシュ（遅延可能）
    setTimeout(() => {
        moltenMetalElementCache = buildMoltenMetalElementCache();
    }, 100);
}

// ========================================
// 初期計算実行
// ========================================
function performInitialCalculations() {
    return new Promise((resolve) => {
        const dateCount = domConstantCache.dateCount;
        const totalMachines = domConstantCache.totalMachines;

        // 前月データの初期化
        if (typeof prevUsableMolds !== 'undefined' && prevUsableMolds) {
            prevMonthMoldsOriginal = JSON.parse(JSON.stringify(prevUsableMolds));
            prevMonthMoldsStatus = prevUsableMolds.map(() => ({
                used: false,
                usedBy: null,
                exhausted: false  // 6直完了したかどうかのフラグ
            }));

            // 最初の稼働日（日勤）を探す（dateIndex=0が土日の場合に対応）
            let firstWorkingDateIndex = -1;
            for (let d = 0; d < dateCount; d++) {
                const testSelect = selectElementCache['day']?.[d]?.[0];
                if (testSelect) {
                    firstWorkingDateIndex = d;
                    break;
                }
            }

            // 最初の稼働日で前月末金型を使用している設備の金型を使用済みとしてマーク
            if (firstWorkingDateIndex !== -1) {
                const machineElements = document.querySelectorAll('[data-section="production_plan"][data-shift="day"] .facility-number');
                for (let m = 0; m < totalMachines; m++) {
                    const firstDaySelect = selectElementCache['day']?.[firstWorkingDateIndex]?.[m];
                    const firstDayMoldDisplay = moldCountDisplayCache['day']?.[firstWorkingDateIndex]?.[m];

                    if (firstDaySelect && firstDayMoldDisplay) {
                        const isPrevMonthMold = firstDayMoldDisplay.getAttribute('data-prev-month-mold') === 'true';
                        if (isPrevMonthMold) {
                            const itemName = firstDaySelect.value;
                            const machineName = machineElements[m] ? machineElements[m].textContent.trim() : '';

                            // この設備の前月末金型を検索して使用済みにマーク
                            for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
                                const mold = prevMonthMoldsOriginal[i];
                                if (mold.machine_name === machineName && mold.item_name === itemName) {
                                    prevMonthMoldsStatus[i].used = true;
                                    prevMonthMoldsStatus[i].usedBy = {
                                        machineIndex: m,
                                        itemName: itemName,
                                        dateIndex: firstWorkingDateIndex,
                                        shift: 'day'
                                    };
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 初期化完了フラグを先に設定（在庫計算が動作するように）
        isInitializing = false;

        // 段階的に計算を実行（ページの応答性を向上）
        // ステップ1: 金型使用数を計算
        requestAnimationFrame(() => {
            for (let i = 0; i < dateCount; i++) {
                for (let m = 0; m < totalMachines; m++) {
                    updateMoldCount(i, 'day', m);
                    updateMoldCount(i, 'night', m);
                }
            }

            // ステップ2: 生産台数を計算
            requestAnimationFrame(() => {
                for (let i = 0; i < dateCount; i++) {
                    calculateProduction(i, 'day');
                    calculateProduction(i, 'night');
                }

                // ステップ3: 在庫を再計算（月末在庫カードも自動更新される）
                // 行合計と溶湯計算はrecalculateAllInventory内で非同期実行される
                requestAnimationFrame(() => {
                    recalculateAllInventory();
                    resolve();
                });
            });
        });
    });
}

// ========================================
// 使用可能金型数データ収集
// ========================================
function collectUsableMoldsData() {
    const usableMolds = [];
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    // 1. 月内での途中型替え（reusableMoldsに表示されているもの）を収集
    const endOfMonthMoldSet = new Set();
    reusableMolds.forEach(mold => {
        // 前月末の金型（dateIndex=-1）は除外
        if (mold.dateIndex === -1) return;

        usableMolds.push({
            machine_index: mold.machineIndex,
            item_name: mold.itemName,
            used_count: mold.count,
            end_of_month: false  // 月内で途中で外された金型（翌月まで未使用）
        });

        // 重複チェック用にSetに追加
        endOfMonthMoldSet.add(`${mold.machineIndex}-${mold.itemName}-${mold.count}`);
    });

    // 2. 月末の最終直で取り付いている金型（型数1-5）を収集
    // 実際に稼働している最終直を見つける（土日の場合は前の稼働日）
    let lastShiftDateIndex = -1;
    let lastShift = null;

    // night直から逆順に探す
    for (let d = dateCount - 1; d >= 0; d--) {
        const testNightSelect = selectElementCache['night']?.[d]?.[0];
        if (testNightSelect) {
            lastShiftDateIndex = d;
            lastShift = 'night';
            break;
        }
    }

    // night直が見つからなければday直を探す
    if (lastShiftDateIndex === -1) {
        for (let d = dateCount - 1; d >= 0; d--) {
            const testDaySelect = selectElementCache['day']?.[d]?.[0];
            if (testDaySelect) {
                lastShiftDateIndex = d;
                lastShift = 'day';
                break;
            }
        }
    }

    if (lastShiftDateIndex !== -1 && lastShift) {
        // 最終直で各設備の金型を確認
        for (let m = 0; m < totalMachines; m++) {
            const lastSelect = selectElementCache[lastShift]?.[lastShiftDateIndex]?.[m];
            const lastMoldDisplay = moldCountDisplayCache[lastShift]?.[lastShiftDateIndex]?.[m];

            if (lastSelect && lastMoldDisplay && lastSelect.value) {
                const itemName = lastSelect.value;
                const moldCount = parseInt(lastMoldDisplay.textContent) || 0;

                // 型数が1-5の場合、月末金型として保存
                if (moldCount > 0 && moldCount < MOLD_CHANGE_THRESHOLD) {
                    const moldKey = `${m}-${itemName}-${moldCount}`;

                    // 既にreusableMoldsに含まれていない場合のみ追加
                    if (!endOfMonthMoldSet.has(moldKey)) {
                        usableMolds.push({
                            machine_index: m,
                            item_name: itemName,
                            used_count: moldCount,
                            end_of_month: true
                        });
                    }
                }
            }
        }
    }

    return usableMolds;
}

// ========================================
// 保存機能
// ========================================
function saveProductionPlan() {
    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    // 保存データを収集
    const planData = [];

    // 休出が消された日付を収集（週末で休出がチェックされていない日）
    const weekendsToDelete = [];
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        const dateIndex = Array.from(checkCell.parentElement.children).indexOf(checkCell) - 1;

        if (isWeekend && checkText !== '休出') {
            weekendsToDelete.push(dateIndex);
        }
    });

    // 計画停止、残業時間、金型交換、生産計画を収集
    const stopTimeInputs = document.querySelectorAll('.stop-time-input');
    const overtimeInputs = document.querySelectorAll('.overtime-input');
    const moldChangeInputs = document.querySelectorAll('.mold-change-input');
    const vehicleSelects = document.querySelectorAll('.vehicle-select');

    // 計画停止時間データを収集
    stopTimeInputs.forEach(input => {
        // 非表示のフィールドはスキップ
        if (input.style.display === 'none') return;

        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const machineIndex = parseInt(input.dataset.machineIndex);
        const stopTime = parseInt(input.value) || 0;

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            stop_time: stopTime,
            type: 'stop_time'
        });
    });

    // 残業時間データを収集
    overtimeInputs.forEach(input => {
        // 非表示のフィールドはスキップ
        if (input.style.display === 'none') return;

        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const machineIndex = parseInt(input.dataset.machineIndex);
        const overtime = parseInt(input.value) || 0;

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            overtime: overtime,
            type: 'overtime'
        });
    });

    // 金型交換データを収集
    moldChangeInputs.forEach(input => {
        // 非表示のフィールドはスキップ
        if (input.style.display === 'none') return;

        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const machineIndex = parseInt(input.dataset.machineIndex);
        const moldChange = parseInt(input.value) || 0;

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            mold_change: moldChange,
            type: 'mold_change'
        });
    });

    // 生産計画データを収集
    vehicleSelects.forEach(select => {
        // 非表示のフィールドはスキップ
        const container = select.closest('.select-container');
        if (container && container.style.display === 'none') return;

        const dateIndex = parseInt(select.dataset.dateIndex);
        const shift = select.dataset.shift;
        const machineIndex = parseInt(select.dataset.machineIndex);
        const itemName = select.value;

        // 同じコンテナ内の金型使用数spanを取得
        const moldCountDisplay = container.querySelector('.mold-count-display');
        const moldCount = moldCountDisplay ? (parseInt(moldCountDisplay.textContent) || 0) : 0;

        // 手動ブロック(赤)の場合は-1として保存
        const isManualBlock = moldCountDisplay && moldCountDisplay.getAttribute('data-manual-block') === 'true';
        const moldCountToSave = isManualBlock ? -1 : moldCount;

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            item_name: itemName,
            mold_count: moldCountToSave,
            type: 'production_plan'
        });
    });

    // 在庫数データを収集（0でもすべて保存）
    const inventoryInputs = document.querySelectorAll('.inventory-input');
    inventoryInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const itemName = input.dataset.item;
        const stock = parseInt(input.value) || 0;

        // 在庫数はすべて保存（0でも保存して連続性を保つ）
        planData.push({
            date_index: dateIndex,
            shift: shift,
            item_name: itemName,
            stock: stock,
            type: 'inventory'
        });
    });

    // 出庫数データを収集（0でもすべて保存）
    const deliveryInputs = document.querySelectorAll('.delivery-input');
    deliveryInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const itemName = input.dataset.item;
        const delivery = parseInt(input.value) || 0;

        // 出庫数はすべて保存（週末で休出がなくても出庫がある場合がある）
        planData.push({
            date_index: dateIndex,
            shift: shift,
            item_name: itemName,
            delivery: delivery,
            type: 'delivery'
        });
    });

    // 生産台数データを収集（inputから取得）
    const productionInputs = document.querySelectorAll('.production-input');
    productionInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const itemName = input.dataset.item;
        const productionCount = parseInt(input.value) || 0;

        if (productionCount > 0) {  // 0より大きい生産台数のみ保存
            planData.push({
                date_index: dateIndex,
                shift: shift,
                item_name: itemName,
                production_count: productionCount,
                type: 'production'
            });
        }
    });

    // 稼働率データを収集
    const occupancyRateData = [];
    const operationRateInputs = document.querySelectorAll('.operation-rate-input');
    operationRateInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const occupancyRate = parseFloat(input.value) || 0;

        if (occupancyRate > 0) {
            occupancyRateData.push({
                date_index: dateIndex,
                occupancy_rate: occupancyRate
            });
        }
    });

    // 定時データを収集（平日で「定時」が設定されている場合のみ）
    const regularWorkingHoursData = [];
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const checkText = checkCell.textContent.trim();
        const dateIndex = Array.from(checkCell.parentElement.children).indexOf(checkCell) - 1;
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';

        // 平日で定時が設定されている場合のみ送信
        if (checkText === '定時' && !isWeekend) {
            regularWorkingHoursData.push({
                date_index: dateIndex,
                regular_working_hours: true
            });
        }
    });

    // 使用可能金型数データを収集
    // 自動生成結果がある場合はそれを使用、なければ手動収集
    let usableMoldsData;
    if (window.autoGeneratedUnusedMolds && window.autoGeneratedUnusedMolds.length > 0) {
        // 自動生成の未使用金型データを使用
        usableMoldsData = window.autoGeneratedUnusedMolds.map(mold => {
            // machine_nameからmachine_indexを取得
            const machineRows = document.querySelectorAll('.facility-number');
            let machineIndex = -1;
            machineRows.forEach((row, index) => {
                if (index < 4 && row.textContent.trim() === mold.machine_name) {
                    machineIndex = index;
                }
            });

            return {
                machine_index: machineIndex,
                item_name: mold.item_name,
                used_count: mold.used_count,
                end_of_month: mold.end_of_month
            };
        });
    } else {
        // 手動収集
        usableMoldsData = collectUsableMoldsData();
    }

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookie('csrftoken');

    if (!csrfToken) {
        showToast('error', 'CSRFトークンが取得できませんでした。ページをリロードしてください。');
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
        return;
    }

    // POSTリクエスト送信
    fetch(window.location.href, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            plan_data: planData,
            weekends_to_delete: weekendsToDelete,
            usable_molds_data: usableMoldsData,
            occupancy_rate_data: occupancyRateData,
            regular_working_hours_data: regularWorkingHoursData
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showToast('success', '保存しました');
            } else {
                showToast('error', '保存に失敗しました: ' + (data.message || ''));
            }
        })
        .catch(error => {
            showToast('errror', '保存に失敗しました: ' + error.message);
        })
        .finally(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = '保存';
        });
}

// ========================================
// 自動生産計画
// ========================================
function autoProductionPlan() {
    const autoBtn = document.getElementById('auto-btn');
    autoBtn.disabled = true;
    autoBtn.textContent = '計算中...';

    // 対象年月を取得
    const targetMonthInput = document.getElementById('target-month');
    const selectedMonth = targetMonthInput.value;

    if (!selectedMonth) {
        showToast('error', '対象月を選択してください');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        return;
    }

    // ローディング表示を開始
    if (typeof showLoading === 'function') {
        showLoading();
    }

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

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookie('csrftoken');

    if (!csrfToken) {
        showToast('error', 'CSRFトークンが取得できませんでした。ページをリロードしてください。');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        if (typeof hideLoading === 'function') {
            hideLoading();
        }
        return;
    }

    // 自動生産計画APIを呼び出し
    fetch(`/management_room/production-plan/casting-production-plan/auto/`, {
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
                // 使用されなかった金型データをグローバル変数に保存
                window.autoGeneratedUnusedMolds = data.unused_molds || [];

                // ローディング表示を終了
                if (typeof hideLoading === 'function') {
                    hideLoading();
                }

                // トーストを表示
                showToast('success', '自動生産計画を適用しました。保存ボタンを押してください。');

                // ブラウザにレンダリング時間を与えてから重い処理を実行
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => requestAnimationFrame(resolve));

                // 生産計画を画面に非同期で反映
                await applyAutoProductionPlan(data.data);
            } else {
                if (typeof hideLoading === 'function') {
                    hideLoading();
                }
                showToast('error', '自動生産計画の生成に失敗しました: ' + (data.message || ''));
            }
        })
        .catch(error => {
            if (typeof hideLoading === 'function') {
                hideLoading();
            }
            showToast('error', '自動生産計画の生成に失敗しました: ' + error.message);
        })
        .finally(() => {
            autoBtn.disabled = false;
            autoBtn.textContent = '自動';
        });
}

async function applyAutoProductionPlan(planData) {
    // テーブルを一時的に非表示にしてReflow/Repaintを抑制
    const table = document.querySelector('.production-plan-table');
    if (table) {
        table.style.display = 'none';
    }

    // 自動計算の結果を適用する際、前月データは使用しないためクリア
    // （自動計算アルゴリズムが独自にdetached_moldsを管理するため）
    prevMonthMoldsOriginal = [];
    prevMonthMoldsStatus = [];
    cellToPrevMonthMoldIndex = {};

    // 日付ヘッダー行（2行目）から全日付とインデックスのマッピングを作成
    const dateHeaderRow = document.querySelector('thead tr:nth-child(2)');
    const dateHeaders = dateHeaderRow.querySelectorAll('th');
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
    machineRows.forEach((row, index) => {
        const machineName = row.textContent.trim();
        // 残業計画の行は日勤4つ、夜勤4つあるので、最初の4つだけを使う
        if (index < 4) {
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

    // 全ての金型カウントと引き継ぎ情報を再計算
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;
    for (let d = 0; d < dateCount; d++) {
        for (let m = 0; m < totalMachines; m++) {
            updateMoldCount(d, 'day', m);
            updateMoldCount(d, 'night', m);
        }
    }

    // 生産台数を再計算（全日付のインデックスで）
    const allDateIndices = Object.values(dateToIndexMap);
    allDateIndices.forEach(dateIndex => {
        calculateProduction(dateIndex, 'day');
        calculateProduction(dateIndex, 'night');
    });

    // 在庫を再計算
    recalculateAllInventory();

    // 品番変更をチェック（バックエンドで型替え時間を設定済みなので、ハイライトのみ適用）
    applyItemChangeHighlights();

    // 再利用可能金型を更新
    updateReusableMolds();

    // 引き継ぎの矢印を表示
    drawInheritanceArrows();

    // テーブルを再表示
    if (table) {
        table.style.display = '';
    }
}

// ========================================
// 再利用可能金型の管理
// ========================================
function updateReusableMolds() {
    // 【重要】既存の前月金型（dateIndex=-1）を一時保存
    // 品番変更時に追加された前月金型（end_of_month=trueを含む）を保持するため
    const existingPrevMonthMolds = reusableMolds.filter(m => m.dateIndex === -1 && m.shift === 'prev_month');

    reusableMolds = [];

    // 【重要】前月の途中型替え金型（end_of_month=false）を追加
    // これらは月内で型替えされて未使用のまま翌月に持ち越された金型
    if (typeof prevMonthMoldsOriginal !== 'undefined' && prevMonthMoldsOriginal) {
        const machineElements = document.querySelectorAll('[data-section="production_plan"][data-shift="day"] .facility-number');

        prevMonthMoldsOriginal.forEach((mold, index) => {
            // end_of_month=falseのもののみを再利用可能金型リストに追加
            if (!mold.end_of_month && !prevMonthMoldsStatus[index].used && !prevMonthMoldsStatus[index].exhausted) {
                // 設備インデックスを取得
                let moldMachineIndex = -1;
                for (let m = 0; m < machineElements.length; m++) {
                    if (machineElements[m].textContent.trim() === mold.machine_name) {
                        moldMachineIndex = m;
                        break;
                    }
                }

                if (moldMachineIndex !== -1) {
                    // 【重要】重複チェック: 同じ品番・同じカウントの金型が既にリストにある場合は追加しない
                    const exists = reusableMolds.some(m =>
                        m.dateIndex === -1 &&
                        m.shift === 'prev_month' &&
                        m.itemName === mold.item_name &&
                        m.count === mold.used_count
                    );

                    if (!exists) {
                        reusableMolds.push({
                            id: reusableMoldIdCounter++,  // 一意ID
                            itemName: mold.item_name,
                            count: mold.used_count,
                            displayCount: mold.display_count || (mold.used_count + 1),  // 表示用のカウント
                            dateIndex: -1,  // 前月データを示す特殊値
                            shift: 'prev_month',
                            machineIndex: moldMachineIndex
                        });
                    }
                }
            }
        });
    }

    // 品番変更で追加された前月金型（end_of_month=true含む）を復元
    // prevMonthMoldsStatus.usedがfalseになっている金型のみを復元
    existingPrevMonthMolds.forEach(existingMold => {
        // 既に追加されているかチェック
        const alreadyAdded = reusableMolds.some(m =>
            m.dateIndex === -1 &&
            m.shift === 'prev_month' &&
            m.itemName === existingMold.itemName &&
            m.count === existingMold.count
        );

        if (!alreadyAdded) {
            // prevMonthMoldsOriginalから対応する金型を探す
            let shouldRestore = false;
            for (let i = 0; i < prevMonthMoldsOriginal.length; i++) {
                const mold = prevMonthMoldsOriginal[i];
                if (mold.item_name === existingMold.itemName &&
                    mold.used_count === existingMold.count &&
                    !prevMonthMoldsStatus[i].used &&
                    !prevMonthMoldsStatus[i].exhausted) {
                    shouldRestore = true;
                    break;
                }
            }

            if (shouldRestore) {
                reusableMolds.push(existingMold);
            }
        }
    });

    // 3重ループを1つのforEachに変更
    // キャッシュを直接走査することで、シンプルで効率的なコードに
    vehicleSelectCache.forEach((select, key) => {
        // 品番が空の場合はスキップ
        if (!select || !select.value) return;

        // keyから情報を抽出: "shift-dateIndex-machineIndex"
        const [shift, dateIndex, machineIndex] = key.split('-');
        const currentItem = select.value;

        // moldCountDisplayをキャッシュから取得
        const moldCountDisplay = moldCountDisplayCache[shift]?.[dateIndex]?.[machineIndex];
        if (!moldCountDisplay) return;

        const moldCount = parseInt(moldCountDisplay.textContent) || 0;
        const hasInheritanceTarget = moldCountDisplay.hasAttribute('data-mold-inheritance-target');

        // 6未満で、かつ他の直に引き継がれていない金型を記録
        if (moldCount > 0 && moldCount < MOLD_CHANGE_THRESHOLD && !hasInheritanceTarget) {
            // 次の直で違う品番が選択されているかチェック
            const nextShiftItemName = getNextShiftItemName(parseInt(dateIndex), shift, parseInt(machineIndex));

            // 次の直で違う品番が選択されている場合のみ、再利用可能金型リストに追加
            // （月末の最終直は表示しない。ただし、保存時にはUsableMoldとして保存される）
            if (nextShiftItemName !== null && nextShiftItemName !== currentItem) {
                // 月内での途中型替えのみを配列に追加
                reusableMolds.push({
                    id: reusableMoldIdCounter++,  // 一意ID
                    itemName: currentItem,
                    count: moldCount,
                    dateIndex: parseInt(dateIndex),
                    shift: shift,
                    machineIndex: parseInt(machineIndex)
                });
            }
        }
    });

    displayReusableMolds();

    // 引き継ぎの矢印も更新
    drawInheritanceArrows();
}

// ========================================
// 金型引き継ぎの矢印表示
// ========================================
function drawInheritanceArrows() {
    const svg = document.getElementById('inheritance-arrows');
    if (!svg) {
        console.warn('SVG element not found');
        return;
    }

    // 既存の矢印をクリア
    const existingPaths = svg.querySelectorAll('path, text, rect');
    existingPaths.forEach(el => el.remove());

    // テーブルコンテナの位置を取得
    const tableContainer = document.getElementById('schedule-table');
    if (!tableContainer) {
        console.warn('Table container not found');
        return;
    }

    const containerRect = tableContainer.getBoundingClientRect();
    let arrowCount = 0;

    // すべてのmold-count-displayを走査して、引き継ぎ先がある場合は矢印を描画
    vehicleSelectCache.forEach((select, key) => {
        const [shift, dateIndex, machineIndex] = key.split('-');
        const moldCountDisplay = moldCountDisplayCache[shift]?.[dateIndex]?.[machineIndex];

        if (!moldCountDisplay) return;

        // 引き継ぎ先の情報を取得
        const inheritanceTargetStr = moldCountDisplay.getAttribute('data-mold-inheritance-target');
        if (!inheritanceTargetStr) return;

        try {
            const target = JSON.parse(inheritanceTargetStr);

            // 品番が一致しているかチェック
            const currentItem = select.value;
            if (target.itemName !== currentItem) {
                return; // 品番が一致しない場合は矢印を描画しない
            }

            // 連続生産かどうかをチェック
            // 同一設備で連続生産している場合は矢印を表示しない
            const sourceMachineIndex = parseInt(machineIndex);
            const targetMachineIndex = target.targetMachineIndex;
            const sourceDateIndex = parseInt(dateIndex);
            const targetDateIndex = target.targetDateIndex;

            // 同一設備かチェック
            if (sourceMachineIndex === targetMachineIndex) {
                // 次の生産直を取得（空セルをスキップ）
                const nextShiftItemName = getNextShiftItemName(sourceDateIndex, shift, sourceMachineIndex);
                const currentItem = select.value;

                // 引き継ぎ先が次の生産直で、同じ品番の場合は連続生産とみなす
                // （つまり、設備を外さずにそのまま使用している）
                if (nextShiftItemName === currentItem) {
                    // 次の生産直を探して、それが引き継ぎ先と一致するかチェック
                    const dateCount = domConstantCache.dateCount;
                    let nextDateIndex = sourceDateIndex;
                    let nextShift = shift;

                    // 次の生産直を探す（最大30直先まで）
                    for (let offset = 1; offset <= 30; offset++) {
                        const next = moveToNextShift(nextDateIndex, nextShift);
                        nextDateIndex = next.dateIndex;
                        nextShift = next.shift;

                        if (nextDateIndex >= dateCount) break;

                        const nextSelect = selectElementCache[nextShift]?.[nextDateIndex]?.[sourceMachineIndex];
                        if (nextSelect && nextSelect.value === currentItem) {
                            // この直が引き継ぎ先と一致する場合は連続生産
                            if (nextDateIndex === targetDateIndex && nextShift === target.targetShift) {
                                // 連続生産なので矢印を描画しない
                                return;
                            }
                            break;
                        }
                    }
                }
            }

            // 引き継ぎ元のセル位置を取得
            const sourceCell = moldCountDisplay.closest('td');
            if (!sourceCell) {
                console.warn('Source cell not found for', key);
                return;
            }

            // 引き継ぎ先のセル位置を取得
            const targetMoldDisplay = moldCountDisplayCache[target.targetShift]?.[target.targetDateIndex]?.[target.targetMachineIndex];
            const targetCell = targetMoldDisplay?.closest('td');
            if (!targetCell) {
                console.warn('Target cell not found for', target);
                return;
            }

            // セルの中心座標を計算（スクロール位置を考慮）
            const sourceRect = sourceCell.getBoundingClientRect();
            const targetRect = targetCell.getBoundingClientRect();

            // tableContainerからの相対位置を計算
            const x1 = sourceRect.left + sourceRect.width / 2 - containerRect.left + tableContainer.scrollLeft;
            const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top + tableContainer.scrollTop;
            const x2 = targetRect.left + targetRect.width / 2 - containerRect.left + tableContainer.scrollLeft;
            const y2 = targetRect.top + targetRect.height / 2 - containerRect.top + tableContainer.scrollTop;

            // 曲線の矢印を描画（ベジェ曲線）
            const dx = x2 - x1;
            const dy = y2 - y1;
            const controlX = x1 + dx / 2;
            const controlY = y1 + dy / 2 - Math.abs(dx) * 0.15; // 上に膨らませる

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`);
            path.setAttribute('stroke', '#4CAF50');
            path.setAttribute('stroke-width', '3');
            path.setAttribute('fill', 'none');
            path.setAttribute('marker-end', 'url(#arrowhead)');
            path.setAttribute('opacity', '0.5'); // 半透明に変更

            svg.appendChild(path);
            arrowCount++;
        } catch (e) {
            console.error('Error parsing inheritance target:', e);
        }
    });
}

// 次の生産直の品番を取得（空セルをスキップ、最大30直先まで）
// 戻り値: 品番名 or null（次の生産直がない場合）
function getNextShiftItemName(dateIndex, shift, machineIndex) {
    const dateCount = domConstantCache.dateCount;
    let currentDateIndex = dateIndex;
    let currentShift = shift;

    // 最大30直先まで探す
    for (let offset = 1; offset <= 30; offset++) {
        // 次の直に移動（ヘルパー関数を使用）
        const next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;

        // 範囲外になったら終了
        if (currentDateIndex >= dateCount) break;

        // キャッシュから取得
        const nextSelect = selectElementCache[currentShift]?.[currentDateIndex]?.[machineIndex];

        // selectが存在し、品番が入っている場合
        if (nextSelect) {
            const nextValue = nextSelect.value || '';
            if (nextValue.trim() !== '') {
                // 品番が入っている直を見つけた
                return nextValue;
            }
            // 品番が空の場合はさらに次を探す（continue）
        }
    }

    // 次の生産直が見つからなかった
    return null;
}

// 次の直で同じ品番を連続生産しているかチェック
// 土日などの空セルをスキップして、次の生産直を探す（最大30直先まで）
function checkIfContinuousToNextShift(dateIndex, shift, machineIndex, itemName) {
    const dateCount = domConstantCache.dateCount;
    let currentDateIndex = dateIndex;
    let currentShift = shift;

    // 最大30直先まで探す
    for (let offset = 1; offset <= 30; offset++) {
        // 次の直に移動（ヘルパー関数を使用）
        const next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;

        // 範囲外になったら終了
        if (currentDateIndex >= dateCount) break;

        // キャッシュから取得
        const nextSelect = selectElementCache[currentShift]?.[currentDateIndex]?.[machineIndex];

        // selectが存在し、品番が入っている場合
        if (nextSelect) {
            const nextValue = nextSelect.value || '';
            if (nextValue.trim() !== '') {
                // 品番が入っている直を見つけた
                return nextValue === itemName;
            }
            // 品番が空の場合はさらに次を探す（continue）
        }
    }

    // 次の生産直が見つからなかった
    return false;
}

// 再利用可能金型を画面に表示
function displayReusableMolds() {
    const listElement = document.getElementById('reusable-molds-list');
    if (!listElement) return;

    listElement.innerHTML = '';

    // 品番名でソート、同じ品番の場合は日付でソート
    const sortedMolds = reusableMolds.sort((a, b) => {
        if (a.itemName !== b.itemName) {
            return a.itemName.localeCompare(b.itemName);
        }
        if (a.dateIndex !== b.dateIndex) {
            return a.dateIndex - b.dateIndex;
        }
        return a.shift === 'day' ? -1 : 1;
    });

    sortedMolds.forEach((mold) => {
        const moldItem = document.createElement('div');
        moldItem.className = 'reusable-mold-item';

        // 日付情報を取得
        const dates = domConstantCache.dates || [];
        let dateStr, shiftStr;
        if (mold.dateIndex === -1 && mold.shift === 'prev_month') {
            // 前月末の金型
            dateStr = '前月末';
            shiftStr = '';
        } else {
            dateStr = dates[mold.dateIndex] ? `${dates[mold.dateIndex].day}日` : `${mold.dateIndex + 1}日`;
            shiftStr = mold.shift === 'day' ? '日勤' : '夜勤';
        }

        const backgroundColor = colorMap[mold.itemName] || '';

        const dateShiftText = shiftStr ? `${dateStr} ${shiftStr}` : dateStr;
        moldItem.innerHTML = `
            <span class="mold-date">${dateShiftText}</span>
            <span class="item-name">${mold.itemName}</span>
            <span class="mold-count">${mold.count}</span>
        `;

        // 背景色を設定
        if (backgroundColor) {
            moldItem.style.backgroundColor = backgroundColor;
        }

        listElement.appendChild(moldItem);
    });
}

// ========================================
// 初期化
// ========================================
async function initialize() {
    // ページ読み込み時は既にloading.jsでローディングが表示されている

    const targetMonthInput = document.getElementById('target-month');
    const lineSelect = document.getElementById('line-select');
    const saveBtn = document.getElementById('save-btn');
    const autoBtn = document.getElementById('auto-btn');
    const scheduleTable = document.getElementById('schedule-table');

    // ========================================
    // ステップ1: 基本UIの初期化
    // ========================================

    // select2を初期化
    if (typeof $ !== 'undefined' && typeof $.fn.select2 !== 'undefined') {
        $(lineSelect).select2({
            theme: 'bootstrap-5',
            width: 'auto',
            placeholder: '選択してください',
            allowClear: false
        });
    }

    // ========================================
    // ステップ2: DOMキャッシュとデータキャッシュの構築
    // ========================================
    buildDOMCache();                    // DOM要素をキャッシュ（最優先）
    buildAllCaches();                   // 計算用キャッシュを一括構築

    // ========================================
    // ステップ3: 即座に表示が必要な初期化処理
    // ========================================
    initializeSelectColors();           // セレクトボックスの色を初期化
    updateOvertimeInputVisibility();    // 残業inputの表示/非表示を初期化（チラつき防止）
    initializeWeekendWorkingStatus();   // 休出・定時状態を初期化

    // ========================================
    // ステップ4: イベントリスナーとインタラクション
    // ========================================
    setupEventListeners();              // イベントリスナーを設定
    setupColumnHover();                 // 列のホバー処理を設定

    // ========================================
    // ステップ5: 初期計算（非同期で段階的に実行）
    // ========================================
    await performInitialCalculations();

    // ========================================
    // ステップ6: 重い処理を遅延実行（ページ応答性を向上）
    // ========================================
    await new Promise(resolve => {
        setTimeout(() => {
            updateWorkingDayStatus(false);   // 稼働日状態を初期化（再計算なし）
            applyItemChangeHighlights();     // 型替えハイライトと残業制御を適用
            drawInheritanceArrows();         // 金型引き継ぎの矢印を表示

            // ========================================
            // ステップ7: ページ初期化完了
            // ========================================
            // すべての初期化が完了したら、テーブルを表示
            if (scheduleTable) {
                scheduleTable.classList.remove('table-initializing');
                scheduleTable.classList.add('table-ready');
            }

            resolve();
        }, 0);
    });

    // ローディング非表示
    if (typeof hideLoading === 'function') {
        hideLoading();
    }

    // ウィンドウリサイズ時・スクロール時に矢印を再描画
    const debouncedRedrawArrows = debounce(() => {
        drawInheritanceArrows();
    }, 100);

    window.addEventListener('resize', debouncedRedrawArrows);
    const tableContainer = document.getElementById('schedule-table');
    if (tableContainer) {
        tableContainer.addEventListener('scroll', debouncedRedrawArrows);
    }

    // ボタンのイベントリスナー
    if (saveBtn) {
        saveBtn.addEventListener('click', saveProductionPlan);
    }
    if (autoBtn) {
        autoBtn.addEventListener('click', autoProductionPlan);
    }

    // 月・ライン変更時のハンドラー
    const handleChange = function () {
        const selectedLine = (typeof $ !== 'undefined' && $(lineSelect).data('select2'))
            ? $(lineSelect).val()
            : lineSelect.value;
        const selectedMonth = targetMonthInput.value;

        if (!selectedLine || !selectedMonth) {
            showToast('error', 'ラインと対象月を選択してください');
            return;
        }

        const [year, month] = selectedMonth.split('-');
        window.location.href = `?line=${selectedLine}&year=${year}&month=${month}`;
    };

    // 月の変更時にデータを再取得
    if (targetMonthInput) {
        targetMonthInput.addEventListener('change', handleChange);
    }

    // ラインの変更時にデータを再取得
    if (typeof $ !== 'undefined' && typeof $.fn.select2 !== 'undefined') {
        $(lineSelect).on('change', handleChange);
    } else {
        lineSelect.addEventListener('change', handleChange);
    }
}

// ========================================
// セクションドラッグ&ドロップ機能は削除されました
// ========================================

// ========================================
// 月末在庫カード更新機能
// ========================================
// 月末在庫カード要素のキャッシュ
let inventoryCardCache = null;

function buildInventoryCardCache() {
    const cache = {};
    document.querySelectorAll('.monthly-plan-item').forEach(card => {
        const itemName = card.dataset.itemName;
        if (itemName) {
            cache[itemName] = {
                card: card,
                inventorySpan: card.querySelector('.end-of-month-inventory'),
                diffSpan: card.querySelector('.monthly-plan-diff'),
                optimalInventory: parseInt(card.dataset.optimalInventory) || 0
            };
        }
    });
    return cache;
}

function updateInventoryComparisonCard(allItemNamesArray = null, dateCount = null) {
    // キャッシュが未作成の場合は作成
    if (!inventoryCardCache) {
        inventoryCardCache = buildInventoryCardCache();
    }
    if (!inventoryElementCache) {
        inventoryElementCache = buildInventoryElementCache();
    }

    // パラメータが渡されていない場合は自分で計算
    if (!dateCount) {
        dateCount = domConstantCache.dateCount;
    }
    if (!allItemNamesArray) {
        const itemDataKeys = Object.keys(itemData);
        const prevKeys = Object.keys(previousMonthInventory);
        allItemNamesArray = [...new Set([...itemDataKeys, ...prevKeys])];
    }

    // 最終日付のインデックス（高速化：ループの外で計算）
    const lastDateIndex = dateCount - 1;

    for (let i = 0; i < allItemNamesArray.length; i++) {
        const itemName = allItemNamesArray[i];
        let endOfMonthInventory = 0;

        // 最後の日付から逆順に検索して、最初に見つかった在庫値を使用
        // 高速化：最も一般的なケース（最終日の夜勤）を最初にチェック
        for (let dateIndex = lastDateIndex; dateIndex >= 0; dateIndex--) {
            const nightKey = `night-${itemName}-${dateIndex}`;
            const nightInventoryInput = inventoryElementCache.inventory[nightKey];

            if (nightInventoryInput && nightInventoryInput.style.display !== 'none') {
                endOfMonthInventory = parseInt(nightInventoryInput.value) || 0;
                break;
            }

            const dayKey = `day-${itemName}-${dateIndex}`;
            const dayInventoryInput = inventoryElementCache.inventory[dayKey];

            if (dayInventoryInput && dayInventoryInput.style.display !== 'none') {
                endOfMonthInventory = parseInt(dayInventoryInput.value) || 0;
                break;
            }
        }

        // キャッシュから対応するカード要素を取得
        const cardData = inventoryCardCache[itemName];
        if (!cardData || !cardData.inventorySpan) continue;

        // マイナスの場合は"-"付きで表示
        cardData.inventorySpan.textContent = endOfMonthInventory < 0
            ? '-' + Math.abs(endOfMonthInventory)
            : endOfMonthInventory;

        // 差分を計算
        const difference = endOfMonthInventory - cardData.optimalInventory;

        // カードの背景色を変更（高速化：必要な場合のみDOM操作）
        const currentHasShortage = cardData.card.classList.contains('shortage');
        const currentHasExcess = cardData.card.classList.contains('excess');

        if (difference < 0) {
            if (!currentHasShortage) {
                cardData.card.classList.remove('excess');
                cardData.card.classList.add('shortage');
            }
        } else if (difference > 0) {
            if (!currentHasExcess) {
                cardData.card.classList.remove('shortage');
                cardData.card.classList.add('excess');
            }
        } else {
            if (currentHasShortage || currentHasExcess) {
                cardData.card.classList.remove('shortage', 'excess');
            }
        }

        // 差分を更新
        if (cardData.diffSpan) {
            const sign = difference > 0 ? '+' : (difference < 0 ? '-' : '');
            const absDifference = Math.abs(difference);
            cardData.diffSpan.textContent = '(' + sign + absDifference + ')';
        }
    }
}

// ========================================
// 列のホバー処理（日付セルのみ黄色）
// ========================================
function setupColumnHover() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    let currentHoverDateIndex = -1;

    tbody.addEventListener('mouseover', function (e) {
        const cell = e.target.closest('td, th');
        if (!cell) return;

        // tdセルのみを対象とする（thは固定列なので除外）
        if (cell.tagName !== 'TD') return;

        // data-date-indexを使って日付インデックスを取得
        const dateIndex = cell.getAttribute('data-date-index');
        if (dateIndex === null) return;

        const dateIndexNum = parseInt(dateIndex);

        // 同じ日付を再度ホバーした場合は何もしない
        if (dateIndexNum === currentHoverDateIndex) return;

        // 前の日付のハイライトを削除
        if (currentHoverDateIndex >= 0) {
            removeDateHighlight(currentHoverDateIndex);
        }

        // 新しい日付セルをハイライト
        currentHoverDateIndex = dateIndexNum;
        addDateHighlight(dateIndexNum);
    });

    tbody.addEventListener('mouseout', function (e) {
        // tbodyから完全に出た場合のみハイライトを削除
        if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
            if (currentHoverDateIndex >= 0) {
                removeDateHighlight(currentHoverDateIndex);
                currentHoverDateIndex = -1;
            }
        }
    });
}

function addDateHighlight(dateIndex) {
    // dateIndexは data-date-index の値（0始まりの日付インデックス）

    // 最上部のヘッダー日付（thead内の2行目）
    // thead 2行目: インデックス0から日付列が始まる（rowspanで固定列は1行目に結合済み）
    const headerDateRow = document.querySelector('thead tr:nth-child(2)');
    if (headerDateRow && headerDateRow.children[dateIndex]) {
        headerDateRow.children[dateIndex].classList.add('date-hover');
    }

    // セクション日付ヘッダー（.section-date-header）
    // セクションヘッダー: インデックス0はcolspan=3、インデックス1以降が日付列
    const sectionDateHeaders = document.querySelectorAll('.section-date-header');
    sectionDateHeaders.forEach(row => {
        // セクションヘッダーの日付列は インデックス1から始まる（0はcolspan=3）
        const sectionDateIndex = dateIndex + 1;
        if (row.children[sectionDateIndex]) {
            row.children[sectionDateIndex].classList.add('date-hover');
        }
    });
}

function removeDateHighlight(dateIndex) {
    // dateIndexは data-date-index の値（0始まりの日付インデックス）

    // 最上部のヘッダー日付（thead内の2行目）
    // thead 2行目: インデックス0から日付列が始まる（rowspanで固定列は1行目に結合済み）
    const headerDateRow = document.querySelector('thead tr:nth-child(2)');
    if (headerDateRow && headerDateRow.children[dateIndex]) {
        headerDateRow.children[dateIndex].classList.remove('date-hover');
    }

    // セクション日付ヘッダー（.section-date-header）
    // セクションヘッダー: インデックス0はcolspan=3、インデックス1以降が日付列
    const sectionDateHeaders = document.querySelectorAll('.section-date-header');
    sectionDateHeaders.forEach(row => {
        // セクションヘッダーの日付列は インデックス1から始まる（0はcolspan=3）
        const sectionDateIndex = dateIndex + 1;
        if (row.children[sectionDateIndex]) {
            row.children[sectionDateIndex].classList.remove('date-hover');
        }
    });
}

// ========================================
// 行合計の計算と更新
// ========================================

// ヘルパー関数: 入力値の合計を計算
function sumInputValues(inputs) {
    let total = 0;
    inputs.forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    return total;
}

// ヘルパー関数: シフト別の合計を計算（品番ベース）
function calculateShiftTotalByItem(className, inputClass, dataKey) {
    document.querySelectorAll(`.${className}`).forEach(totalCell => {
        const shift = totalCell.dataset.shift;
        const itemName = totalCell.dataset[dataKey];
        const inputs = document.querySelectorAll(
            `.${inputClass}[data-shift="${shift}"][data-${dataKey}="${itemName}"]`
        );
        totalCell.textContent = sumInputValues(inputs);
    });
}

// ヘルパー関数: シフト別の合計を計算（設備ベース）
function calculateShiftTotalByMachine(className, inputClass) {
    document.querySelectorAll(`.${className}`).forEach(totalCell => {
        const shift = totalCell.dataset.shift;
        const machineIndex = totalCell.dataset.machineIndex;
        const inputs = document.querySelectorAll(
            `.${inputClass}[data-shift="${shift}"][data-machine-index="${machineIndex}"]`
        );
        totalCell.textContent = sumInputValues(inputs);
    });
}

// ヘルパー関数: 日勤+夜勤の合計を計算（品番ベース）
function calculateCombinedTotalByItem(className, inputClass, dataKey) {
    document.querySelectorAll(`.${className}`).forEach(totalCell => {
        const itemName = totalCell.dataset[dataKey];
        const dayInputs = document.querySelectorAll(
            `.${inputClass}[data-shift="day"][data-${dataKey}="${itemName}"]`
        );
        const nightInputs = document.querySelectorAll(
            `.${inputClass}[data-shift="night"][data-${dataKey}="${itemName}"]`
        );
        const total = sumInputValues(dayInputs) + sumInputValues(nightInputs);
        totalCell.textContent = total;
    });
}

// ヘルパー関数: 日勤+夜勤の合計を計算（設備ベース）
function calculateCombinedTotalByMachine(className, inputClass) {
    document.querySelectorAll(`.${className}`).forEach(totalCell => {
        const machineIndex = totalCell.dataset.machineIndex;
        const dayInputs = document.querySelectorAll(
            `.${inputClass}[data-shift="day"][data-machine-index="${machineIndex}"]`
        );
        const nightInputs = document.querySelectorAll(
            `.${inputClass}[data-shift="night"][data-machine-index="${machineIndex}"]`
        );
        const total = sumInputValues(dayInputs) + sumInputValues(nightInputs);
        totalCell.textContent = total;
    });
}

function calculateRowTotals() {
    // 出庫数の合計（日勤・夜勤別）
    calculateShiftTotalByItem('delivery-total', 'delivery-input', 'item');

    // 出庫数の合計（日勤+夜勤）
    calculateCombinedTotalByItem('delivery-combined-total', 'delivery-input', 'item');

    // 生産台数の合計（日勤・夜勤別）
    calculateShiftTotalByItem('production-total', 'production-input', 'item');

    // 生産台数の合計（日勤+夜勤）
    calculateCombinedTotalByItem('production-combined-total', 'production-input', 'item');

    // 在庫の増減（生産台数合計 - 出庫数合計）
    // inventoryElementCacheを使用して高速化
    document.querySelectorAll('.inventory-difference-total').forEach(totalCell => {
        const itemName = totalCell.dataset.item;
        let productionTotal = 0;
        let deliveryTotal = 0;

        // キャッシュから直接値を取得
        if (inventoryElementCache) {
            const dateCount = domConstantCache.dateCount;
            for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
                // 日勤
                const productionDayKey = `day-${itemName}-${dateIndex}`;
                const deliveryDayKey = `day-${itemName}-${dateIndex}`;
                const productionDayInput = inventoryElementCache.production[productionDayKey];
                const deliveryDayInput = inventoryElementCache.delivery[deliveryDayKey];

                if (productionDayInput) productionTotal += parseFloat(productionDayInput.value) || 0;
                if (deliveryDayInput) deliveryTotal += parseFloat(deliveryDayInput.value) || 0;

                // 夜勤
                const productionNightKey = `night-${itemName}-${dateIndex}`;
                const deliveryNightKey = `night-${itemName}-${dateIndex}`;
                const productionNightInput = inventoryElementCache.production[productionNightKey];
                const deliveryNightInput = inventoryElementCache.delivery[deliveryNightKey];

                if (productionNightInput) productionTotal += parseFloat(productionNightInput.value) || 0;
                if (deliveryNightInput) deliveryTotal += parseFloat(deliveryNightInput.value) || 0;
            }
        }

        const difference = productionTotal - deliveryTotal;
        totalCell.textContent = difference >= 0 ? `+${difference}` : difference;
    });

    // 金型交換の合計（日勤・夜勤別）
    calculateShiftTotalByMachine('mold-change-total', 'mold-change-input');

    // 金型交換の合計（日勤+夜勤）
    calculateCombinedTotalByMachine('mold-change-combined-total', 'mold-change-input');

    // 残業計画の合計（日勤・夜勤別）
    calculateShiftTotalByMachine('overtime-total', 'overtime-input');

    // 残業計画の合計（日勤+夜勤）
    calculateCombinedTotalByMachine('overtime-combined-total', 'overtime-input');

    // 計画停止の合計（日勤・夜勤別）
    calculateShiftTotalByMachine('stop-time-total', 'stop-time-input');

    // 計画停止の合計（日勤+夜勤）
    calculateCombinedTotalByMachine('stop-time-combined-total', 'stop-time-input');
}

// ========================================
// 溶湯、ポット数、中子の計算
// ========================================
// 高速化のため要素をキャッシュ
let moltenMetalElementCache = null;

function buildMoltenMetalElementCache() {
    const cache = {
        moltenMetal: {},
        potCount: {},
        core: {}
    };

    // 溶湯セルをキャッシュ
    document.querySelectorAll('tr[data-section="molten_metal"] td[data-date-index]').forEach(cell => {
        const shift = cell.closest('tr').dataset.shift;
        const dateIndex = cell.dataset.dateIndex;
        const key = `${shift}-${dateIndex}`;
        cache.moltenMetal[key] = cell;
    });

    // ポット数セルをキャッシュ
    document.querySelectorAll('tr[data-section="pot_count"] td[data-date-index]').forEach(cell => {
        const shift = cell.closest('tr').dataset.shift;
        const dateIndex = cell.dataset.dateIndex;
        const key = `${shift}-${dateIndex}`;
        cache.potCount[key] = cell;
    });

    // 中子セルをキャッシュ
    document.querySelectorAll('tr[data-section="core"] td[data-date-index]').forEach(cell => {
        const itemName = cell.closest('tr').dataset.item;
        const dateIndex = cell.dataset.dateIndex;
        const key = `${itemName}-${dateIndex}`;
        cache.core[key] = cell;
    });

    return cache;
}

function calculateMoltenMetalPotAndCore() {
    // キャッシュが未作成の場合は作成
    if (!moltenMetalElementCache) {
        moltenMetalElementCache = buildMoltenMetalElementCache();
    }

    const dateCount = domConstantCache.dateCount;
    const itemNames = Object.keys(itemData);

    // molten_metal_usageを事前にキャッシュ（繰り返しアクセスを削減）
    const moltenMetalUsageCache = {};
    itemNames.forEach(itemName => {
        moltenMetalUsageCache[itemName] = itemData[itemName].molten_metal_usage || 0;
    });

    // 各直の計算（dayとnightを配列で管理）
    const shifts = ['day', 'night'];

    // 各日付・各直の計算
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        for (let s = 0; s < 2; s++) {
            const shift = shifts[s];
            let moltenMetalTotal = 0;

            // 品番ごとの計算を1ループで実施
            for (let i = 0; i < itemNames.length; i++) {
                const itemName = itemNames[i];
                const productionKey = `${shift}-${itemName}-${dateIndex}`;
                const productionInput = inventoryElementCache?.production[productionKey];

                if (productionInput) {
                    const productionValue = parseFloat(productionInput.value) || 0;

                    if (productionValue > 0) {
                        // 溶湯: 生産数 × 溶湯使用量
                        moltenMetalTotal += productionValue * moltenMetalUsageCache[itemName];

                        // 中子: 生産数（直接DOM更新）
                        const coreKey = `${itemName}-${dateIndex}`;
                        const coreCell = moltenMetalElementCache.core[coreKey];
                        if (coreCell) {
                            coreCell.textContent = productionValue;
                        }
                    } else {
                        // 生産数が0の場合は中子をクリア
                        const coreKey = `${itemName}-${dateIndex}`;
                        const coreCell = moltenMetalElementCache.core[coreKey];
                        if (coreCell) {
                            coreCell.textContent = '';
                        }
                    }
                }
            }

            // 溶湯を表示（キャッシュから取得）
            const moltenMetalKey = `${shift}-${dateIndex}`;
            const moltenMetalCell = moltenMetalElementCache.moltenMetal[moltenMetalKey];
            if (moltenMetalCell) {
                moltenMetalCell.textContent = moltenMetalTotal > 0 ? Math.round(moltenMetalTotal) : '';
            }

            // ポット数を表示: 溶湯 / 1200 を小数点第1位で切り上げ（キャッシュから取得）
            const potCountCell = moltenMetalElementCache.potCount[moltenMetalKey];
            if (potCountCell) {
                if (moltenMetalTotal > 0) {
                    const potCount = Math.ceil(moltenMetalTotal / 1200 * 10) / 10;
                    potCountCell.textContent = potCount.toFixed(1);
                } else {
                    potCountCell.textContent = '';
                }
            }
        }
    }
}

// デバウンス版の合計計算
const debouncedCalculateRowTotals = debounce(calculateRowTotals, 100);

// ========================================
// 残業inputの表示/非表示制御
// ========================================
// 残業inputのキャッシュ
let overtimeInputCache = null;

function buildOvertimeInputCache() {
    const cache = {};
    document.querySelectorAll('.overtime-input').forEach(input => {
        const shift = input.dataset.shift;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${dateIndex}`;
        if (!cache[key]) {
            cache[key] = [];
        }
        cache[key].push(input);
    });
    return cache;
}

function updateOvertimeInputVisibility() {
    // キャッシュが未作成の場合は作成
    if (!overtimeInputCache) {
        overtimeInputCache = buildOvertimeInputCache();
    }

    const checkCells = domConstantCache.checkCells;

    for (let dateIndex = 0; dateIndex < checkCells.length; dateIndex++) {
        const checkCell = checkCells[dateIndex];
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        const isHolidayWork = checkText === '休出';
        const isRegularTime = checkText === '定時';

        // 残業inputをキャッシュから取得
        const dayOvertimeInputs = overtimeInputCache[`day-${dateIndex}`] || [];
        const nightOvertimeInputs = overtimeInputCache[`night-${dateIndex}`] || [];

        if (isWeekend && !isHolidayWork) {
            // 土日（休出なし）の場合：日勤・夜勤両方とも非表示
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = 'none';
                dayOvertimeInputs[i].value = 0;
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = 'none';
                nightOvertimeInputs[i].value = 0;
            }
        } else if (isHolidayWork) {
            // 休出の場合：日勤・夜勤両方とも非表示
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = 'none';
                dayOvertimeInputs[i].value = 0;
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = 'none';
                nightOvertimeInputs[i].value = 0;
            }
        } else if (isRegularTime) {
            // 定時の場合：日勤のみ非表示、夜勤は表示
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = 'none';
                dayOvertimeInputs[i].value = 0;
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = '';
            }
        } else {
            // それ以外は両方表示
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = '';
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = '';
            }
        }
    }
}

// DOMContentLoadedイベントで初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
