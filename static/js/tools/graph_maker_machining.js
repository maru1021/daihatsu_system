/**
 * グラフツクール君2号
 * CSV/Excelファイルを読み込み、グラフを作成・操作するツール
 */

// ===========================
// 定数定義
// ===========================

// 色系統ごとの配色（各系統に4色）- 隣接する色が最大限異なるように配置
const COLOR_FAMILIES = [
    ['rgb(220, 38, 38)', 'rgb(239, 68, 68)', 'rgb(185, 28, 28)', 'rgb(248, 113, 113)'],
    ['rgb(8, 145, 178)', 'rgb(6, 182, 212)', 'rgb(14, 116, 144)', 'rgb(34, 211, 238)'],
    ['rgb(234, 88, 12)', 'rgb(249, 115, 22)', 'rgb(194, 65, 12)', 'rgb(251, 146, 60)'],
    ['rgb(37, 99, 235)', 'rgb(59, 130, 246)', 'rgb(29, 78, 216)', 'rgb(96, 165, 250)'],
    ['rgb(22, 163, 74)', 'rgb(34, 197, 94)', 'rgb(21, 128, 61)', 'rgb(74, 222, 128)'],
    ['rgb(147, 51, 234)', 'rgb(168, 85, 247)', 'rgb(126, 34, 206)', 'rgb(192, 132, 252)'],
    ['rgb(234, 179, 8)', 'rgb(250, 204, 21)', 'rgb(202, 138, 4)', 'rgb(253, 224, 71)'],
    ['rgb(219, 39, 119)', 'rgb(236, 72, 153)', 'rgb(190, 24, 93)', 'rgb(244, 114, 182)']
];

const BLINK_INTERVAL = 1200; // 点滅間隔(ms)
let PAN_SPEED_X = 5; // X軸パン速度（デフォルト値）
let PAN_SPEED_Y = 0.05; // Y軸パン速度（デフォルト値）

// ===========================
// グローバル変数
// ===========================

let chart = null;
let scatterChart = null;     // X-TCMD vs Y-TCMD 散布図
let deviationChart = null;  // 移動平均からの絶対値積算グラフ
let averageChart = null;    // 平均値グラフ
let maxChart = null;         // 最大値グラフ
let derivativeChart = null; // トルク変動率グラフ
let uploadedFiles = [];
let fileOffsets = new Map();
let preserveZoom = false;
let savedZoomState = null;
let datasetVisibility = new Map();
let cachedParsedData = []; // 統計グラフ更新用にキャッシュ
let cachedFileDataToOriginalName = new Map(); // 統計グラフ更新用にキャッシュ
let blinkTimer = null;
let blinkState = true;
let isInitialLoad = true;    // 初回読み込みフラグ

// アクティブなグラフの管理
let activeChart = null; // 'main' or 'derivative'

// 閾値設定
let upperThresholdValue = null;
let lowerThresholdValue = null;

// データ範囲設定
let noLoadStartValue = null;
let noLoadEndValue = null;
let analysisStartValue = null;
let analysisEndValue = null;

// データ範囲ドラッグ用
let isDraggingRangeEdge = false;
let draggingEdgeType = null; // 'noLoadStart', 'noLoadEnd', 'analysisStart', 'analysisEnd'
const EDGE_DETECTION_THRESHOLD = 10; // エッジ検出の閾値（ピクセル）

// UI設定
let tooltipEnabled = false;
let tooltipSingleMode = false; // 凡例(単体)モード
let smoothColumnName = ''; // 移動平均を適用する列名
let smoothWindow = 1; // 移動平均ウィンドウサイズ
let xAxisPattern = '';
let excludedColumns = [];
let excludedFiles = [];
let chartType = 'line';

// 第2軸設定（最大3つ）
let yAxisConfigs = [
    { enabled: false, pattern: '', axis: 'y2', chartType: 'line' },
    { enabled: false, pattern: '', axis: 'y2', chartType: 'line' },
    { enabled: false, pattern: '', axis: 'y2', chartType: 'line' }
];

// キーボード操作用
const keysPressed = {
    ArrowRight: false,
    ArrowLeft: false,
    ArrowUp: false,
    ArrowDown: false
};
let animationFrameId = null;

// スクロールバー用
let isScrollbarUpdating = false; // スクロールバー更新中フラグ（無限ループ防止）

// 3Dシミュレーション用
let simulation3D = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    drillGroup: null,
    workpiece: null,
    animationData: [],
    currentFrame: 0,
    isPlaying: false,
    animationInterval: null,
    isThreeJsLoaded: false
};

// Three.jsの読み込み完了を待つ
window.addEventListener('threejs-loaded', () => {
    simulation3D.isThreeJsLoaded = true;
});

// ===========================
// DOM要素の取得
// ===========================

const elements = {
    csvInput: document.getElementById('csvInput'),
    resetZoomBtn: document.getElementById('resetZoomBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    fileListContainer: document.getElementById('fileListContainer'),
    controlsContainer: document.getElementById('controlsContainer'),
    legendCheckbox: document.getElementById('legendCheckbox'),
    tooltipSingleCheckbox: document.getElementById('tooltipSingleCheckbox'),
    smoothColumnSelect: document.getElementById('smoothColumnSelect'),
    smoothWindowInput: document.getElementById('smoothWindow'),
    xAxisSelect: document.getElementById('xAxisSelect'),
    chartTypeSelect: document.getElementById('chartTypeSelect'),
    excludeContainer: document.getElementById('excludeContainer'),
    upperThresholdInput: document.getElementById('upperThreshold'),
    lowerThresholdInput: document.getElementById('lowerThreshold'),
    panSpeedXInput: document.getElementById('panSpeedX'),
    panSpeedYInput: document.getElementById('panSpeedY'),
    xScrollbar: document.getElementById('xScrollbar'),
    yScrollbar: document.getElementById('yScrollbar'),
    yAxisElements: [
        {
            select: document.getElementById('yAxis1Select'),
            check: document.getElementById('yAxis1Check'),
            input: document.getElementById('yAxis1Input'),
            columnSelect: document.getElementById('yAxis1ColumnSelect'),
            typeSelect: document.getElementById('yAxis1TypeSelect')
        },
        {
            select: document.getElementById('yAxis2Select'),
            check: document.getElementById('yAxis2Check'),
            input: document.getElementById('yAxis2Input'),
            columnSelect: document.getElementById('yAxis2ColumnSelect'),
            typeSelect: document.getElementById('yAxis2TypeSelect')
        },
        {
            select: document.getElementById('yAxis3Select'),
            check: document.getElementById('yAxis3Check'),
            input: document.getElementById('yAxis3Input'),
            columnSelect: document.getElementById('yAxis3ColumnSelect'),
            typeSelect: document.getElementById('yAxis3TypeSelect')
        }
    ]
};

// ===========================
// ユーティリティ関数
// ===========================

/**
 * RGB文字列をRGBAに変換
 */
function rgbToRgba(rgb, alpha) {
    return rgb.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
}

/**
 * 3軸の合成負荷を計算
 * @param {number} xTcmd - X軸トルク指令値
 * @param {number} yTcmd - Y軸トルク指令値
 * @param {number} zTcmd - Z軸トルク指令値
 * @returns {number} 合成負荷
 */
function calculateCompositeLoad(xTcmd, yTcmd, zTcmd) {
    return Math.sqrt(xTcmd * xTcmd + yTcmd * yTcmd + zTcmd * zTcmd);
}

/**
 * データセットから指定されたラベルを含むデータセットを取得
 * @param {Array} datasets - データセット配列
 * @param {string} labelPart - 検索するラベルの一部
 * @returns {Object|undefined} 見つかったデータセット
 */
function findDatasetByLabel(datasets, labelPart) {
    return datasets.find(d => d.label.includes(labelPart));
}

/**
 * 複数のデータセットを一度に取得
 * @param {Object} fileData - ファイルデータ
 * @param {Array<string>} labelParts - 検索するラベルの配列
 * @returns {Object} ラベル名をキーとしたデータセットのマップ
 */
function getDatasets(fileData, labelParts) {
    const result = {};
    for (const label of labelParts) {
        result[label] = findDatasetByLabel(fileData.datasets, label);
    }
    return result;
}

/**
 * ヒートマップ用の色変換（0-1の比率から青→緑→黄→赤のグラデーション）
 * @param {number} ratio - 0から1の範囲の比率
 * @returns {string} RGB色文字列
 */
function getHeatmapColor(ratio) {
    if (ratio < 0.25) {
        // 青 → 緑
        return `rgb(${Math.floor(ratio * 400)}, ${100 + Math.floor(ratio * 620)}, 255)`;
    } else if (ratio < 0.5) {
        // 緑 → 黄
        const r = (ratio - 0.25) * 4;
        return `rgb(${Math.floor(r * 255)}, 255, ${255 - Math.floor(r * 155)})`;
    } else if (ratio < 0.75) {
        // 黄 → オレンジ
        const r = (ratio - 0.5) * 4;
        return `rgb(255, ${255 - Math.floor(r * 155)}, ${100 - Math.floor(r * 100)})`;
    } else {
        // オレンジ → 赤
        const r = (ratio - 0.75) * 4;
        return `rgb(255, ${100 - Math.floor(r * 100)}, 0)`;
    }
}

/**
 * 移動平均でスムージング
 */
function applyMovingAverage(data, windowSize) {
    if (windowSize <= 1) return data;

    const smoothed = [];
    for (let i = 0; i < data.length; i++) {
        let sum = 0;
        let count = 0;
        const halfWindow = Math.floor(windowSize / 2);

        for (let j = Math.max(0, i - halfWindow); j <= Math.min(data.length - 1, i + halfWindow); j++) {
            sum += data[j].y;
            count++;
        }

        smoothed.push({
            x: data[i].x,
            y: sum / count
        });
    }
    return smoothed;
}

/**
 * 現在のズーム状態を保存
 */
function saveCurrentZoomState() {
    if (!chart) return;

    savedZoomState = {
        x: { min: chart.scales.x.min, max: chart.scales.x.max },
        y: { min: chart.scales.y.min, max: chart.scales.y.max },
        y2: chart.scales.y2 ? { min: chart.scales.y2.min, max: chart.scales.y2.max } : undefined,
        y3: chart.scales.y3 ? { min: chart.scales.y3.min, max: chart.scales.y3.max } : undefined,
        y4: chart.scales.y4 ? { min: chart.scales.y4.min, max: chart.scales.y4.max } : undefined
    };
    preserveZoom = true;

    // スクロールバーを更新
    updateScrollbarsFromChart();
}

/**
 * グラフの現在位置に基づいてスクロールバーを更新
 */
function updateScrollbarsFromChart() {
    if (!chart || isScrollbarUpdating) return;

    isScrollbarUpdating = true;

    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const xLimits = chart.options.plugins.zoom.limits.x;
    const yLimits = chart.options.plugins.zoom.limits.y;

    const xScrollbarContainer = document.querySelector('.chart-x-scrollbar-container');
    const yScrollbarContainer = document.querySelector('.chart-y-scrollbar-container');

    if (xScale && xLimits) {
        // X軸のスクロールバー位置を計算（0-100の範囲）
        const xViewRange = xScale.max - xScale.min;
        const xScrollableRange = (xLimits.max - xLimits.min) - xViewRange;

        if (xScrollableRange > 0.001) { // 微小な差は無視（浮動小数点誤差対策）
            // スクロール可能 → スクロールバーを表示
            xScrollbarContainer.style.display = 'flex';
            const xPosition = ((xScale.min - xLimits.min) / xScrollableRange) * 100;
            elements.xScrollbar.value = Math.max(0, Math.min(100, xPosition));
        } else {
            // スクロール不要 → スクロールバーを非表示
            xScrollbarContainer.style.display = 'none';
            elements.xScrollbar.value = 0;
        }
    }

    if (yScale && yLimits) {
        // Y軸のスクロールバー位置を計算（0-100の範囲）
        const yViewRange = yScale.max - yScale.min;
        const yScrollableRange = (yLimits.max - yLimits.min) - yViewRange;

        if (yScrollableRange > 0.001) { // 微小な差は無視（浮動小数点誤差対策）
            // スクロール可能 → スクロールバーを表示
            yScrollbarContainer.style.display = 'flex';
            const yPosition = ((yScale.min - yLimits.min) / yScrollableRange) * 100;
            elements.yScrollbar.value = Math.max(0, Math.min(100, yPosition));
        } else {
            // スクロール不要 → スクロールバーを非表示
            yScrollbarContainer.style.display = 'none';
            elements.yScrollbar.value = 0;
        }
    }

    isScrollbarUpdating = false;
}

/**
 * スクロールバーの位置からグラフをパン
 */
function panFromScrollbar(axis, scrollValue) {
    if (!chart || isScrollbarUpdating) return;

    const scale = chart.scales[axis];
    const limits = chart.options.plugins.zoom.limits[axis];

    if (!scale || !limits) return;

    // スクロールバーの値（0-100）をグラフの位置に変換
    const viewRange = scale.max - scale.min;
    const scrollableRange = (limits.max - limits.min) - viewRange;

    // スクロール位置からminを計算
    // scrollValue = 0 → min = limits.min（左端/下端）
    // scrollValue = 100 → min = limits.max - viewRange（右端/上端）
    const newMin = limits.min + (scrollableRange * scrollValue / 100);

    // 範囲を制限内に収める
    const clampedMin = Math.max(limits.min, Math.min(limits.max - viewRange, newMin));
    const clampedMax = clampedMin + viewRange;

    // チャートを更新
    chart.scales[axis].options.min = clampedMin;
    chart.scales[axis].options.max = clampedMax;

    // Y軸の場合は第2～第4軸も一緒に移動
    if (axis === 'y') {
        ['y2', 'y3', 'y4'].forEach(yAxis => {
            if (chart.scales[yAxis]) {
                const yScale = chart.scales[yAxis];
                const yLimits = chart.options.plugins.zoom.limits[yAxis];

                if (yLimits) {
                    const yViewRange = yScale.max - yScale.min;
                    const yScrollableRange = (yLimits.max - yLimits.min) - yViewRange;

                    const yNewMin = yLimits.min + (yScrollableRange * scrollValue / 100);

                    const yClampedMin = Math.max(yLimits.min, Math.min(yLimits.max - yViewRange, yNewMin));
                    const yClampedMax = yClampedMin + yViewRange;

                    chart.scales[yAxis].options.min = yClampedMin;
                    chart.scales[yAxis].options.max = yClampedMax;
                }
            }
        });
    }

    chart.update('none');

    saveCurrentZoomState();
}


/**
 * 軸をパン（移動）する
 */
function panAxis(axis, delta) {
    if (!chart || !chart.scales[axis]) return;

    const scale = chart.scales[axis];
    const currentRange = scale.max - scale.min;
    const chartArea = chart.chartArea;
    const dimension = axis === 'x'
        ? chartArea.right - chartArea.left
        : chartArea.bottom - chartArea.top;
    const pixelPerUnit = dimension / currentRange;
    const deltaInPixels = delta * pixelPerUnit;

    const panConfig = {};
    panConfig[axis] = deltaInPixels;
    chart.pan(panConfig, undefined, 'none');

    // Y軸の場合は第2～第4軸も一緒に移動
    if (axis === 'y') {
        ['y2', 'y3', 'y4'].forEach(yAxis => {
            if (chart.scales[yAxis]) {
                const yScale = chart.scales[yAxis];
                const yLimits = chart.options.plugins.zoom.limits[yAxis];

                if (yLimits) {
                    const yCurrentRange = yScale.max - yScale.min;
                    let yNewMin = yScale.min + delta;
                    let yNewMax = yScale.max + delta;

                    // 範囲を制限内に収める
                    if (yNewMin < yLimits.min) {
                        yNewMin = yLimits.min;
                        yNewMax = yLimits.min + yCurrentRange;
                    }
                    if (yNewMax > yLimits.max) {
                        yNewMax = yLimits.max;
                        yNewMin = yLimits.max - yCurrentRange;
                    }

                    chart.scales[yAxis].options.min = yNewMin;
                    chart.scales[yAxis].options.max = yNewMax;
                }
            }
        });

        // 第2軸以降を更新した場合は再描画
        chart.update('none');
    }

    saveCurrentZoomState();
}

/**
 * 任意のチャートの軸をパン（移動）する
 */
function panAxisForChart(targetChart, axis, delta) {
    if (!targetChart || !targetChart.scales[axis]) return;

    const scale = targetChart.scales[axis];
    const currentRange = scale.max - scale.min;
    const chartArea = targetChart.chartArea;
    const dimension = axis === 'x'
        ? chartArea.right - chartArea.left
        : chartArea.bottom - chartArea.top;
    const pixelPerUnit = dimension / currentRange;
    const deltaInPixels = delta * pixelPerUnit;

    const panConfig = {};
    panConfig[axis] = deltaInPixels;
    targetChart.pan(panConfig, undefined, 'none');

    // メインチャートの場合のみ、Y軸の第2～第4軸も一緒に移動
    if (targetChart === chart && axis === 'y') {
        ['y2', 'y3', 'y4'].forEach(yAxis => {
            if (targetChart.scales[yAxis]) {
                const yScale = targetChart.scales[yAxis];
                const yLimits = targetChart.options.plugins.zoom.limits[yAxis];

                if (yLimits) {
                    const yCurrentRange = yScale.max - yScale.min;
                    let yNewMin = yScale.min + delta;
                    let yNewMax = yScale.max + delta;

                    // 範囲を制限内に収める
                    if (yNewMin < yLimits.min) {
                        yNewMin = yLimits.min;
                        yNewMax = yLimits.min + yCurrentRange;
                    }
                    if (yNewMax > yLimits.max) {
                        yNewMax = yLimits.max;
                        yNewMin = yLimits.max - yCurrentRange;
                    }

                    targetChart.scales[yAxis].options.min = yNewMin;
                    targetChart.scales[yAxis].options.max = yNewMax;
                }
            }
        });

        // 第2軸以降を更新した場合は再描画
        targetChart.update('none');
    }

    // スクロールバーを更新
    updateScrollbarsForChart(targetChart);
}

/**
 * チャートに応じてスクロールバーを更新
 */
function updateScrollbarsForChart(targetChart) {
    if (targetChart === chart) {
        saveCurrentZoomState();
    }
}

/**
 * 第2軸のIDを取得
 */
function getYAxisID(label) {
    const columnName = label.split(' - ')[1] || '';

    for (let config of yAxisConfigs) {
        if (config.pattern && config.pattern.trim() !== '') {
            const isMatch = config.enabled
                ? columnName.includes(config.pattern.trim())
                : columnName === config.pattern.trim();

            if (isMatch) return config.axis;
        }
    }
    return 'y';
}

/**
 * グラフの種類を取得
 */
function getChartType(label) {
    const columnName = label.split(' - ')[1] || '';

    for (let config of yAxisConfigs) {
        if (config.pattern && config.pattern.trim() !== '') {
            const isMatch = config.enabled
                ? columnName.includes(config.pattern.trim())
                : columnName === config.pattern.trim();

            if (isMatch) return config.chartType;
        }
    }
    return chartType;
}

// ===========================
// ファイル解析関数
// ===========================

/**
 * Z-TCMDが1を超える行を検出
 */
function detectSpeedRiseRow(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return 0;

    const headers = lines[0].split(',').map(h => h.trim());
    const zTcmdIndex = headers.findIndex(h => h === 'Z-TCMD');

    if (zTcmdIndex === -1) return 0;

    // 初期値が1を超えているかチェック
    const firstValues = lines[1].split(',');
    const firstZTcmd = parseFloat(firstValues[zTcmdIndex]);

    let startSearching = false;
    if (isNaN(firstZTcmd) || firstZTcmd <= 1) {
        // 初期値が1以下の場合、すぐに検索開始
        startSearching = true;
    }

    // Z-TCMDが1を超える行を検出
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const zTcmdValue = parseFloat(values[zTcmdIndex]);

        if (isNaN(zTcmdValue)) continue;

        // 初期値が1を超えていた場合、0以下になるまで待つ
        if (!startSearching && zTcmdValue <= 0) {
            startSearching = true;
            continue;
        }

        // 検索開始後、1を超えたところを検出
        if (startSearching && zTcmdValue > 1) {
            return i - 1; // データ行のインデックス（ヘッダーを除く）
        }
    }

    return 0;
}

/**
 * CSVファイルを解析
 */
function parseCSV(text, fileName, offset = 0) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('CSVファイルが空か、データが不足しています');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const columnCount = headers.length;

    if (columnCount < 1) {
        throw new Error('CSVファイルには少なくとも1列が必要です');
    }

    const datasets = headers.map((header) => ({
        label: `${fileName} - ${header}`,
        data: []
    }));

    const dataRowCount = lines.length - 1;
    const minIndex = offset;
    const maxIndex = offset + dataRowCount - 1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(',');
        if (values.length >= 1) {
            const dataIndex = i - 1;
            const xValue = (dataIndex + offset).toString();

            for (let col = 0; col < Math.min(values.length, columnCount); col++) {
                const yValue = parseFloat(values[col].trim());
                if (!isNaN(yValue)) {
                    datasets[col].data.push({ x: xValue, y: yValue });
                }
            }
        }
    }

    return { datasets, minIndex, maxIndex, fileName };
}

/**
 * Excelファイルを解析（全シート対応）
 */
async function parseExcel(file, fileName, offset = 0) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const results = [];

    for (let sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!jsonData || jsonData.length < 2) continue;

        const headers = jsonData[0].map(h => h ? h.toString().trim() : '');
        const columnCount = headers.length;

        if (columnCount < 1) continue;

        const sheetFileName = workbook.SheetNames.length > 1
            ? `${fileName}_${sheetName}`
            : fileName;

        const datasets = headers.map((header) => ({
            label: `${sheetFileName} - ${header}`,
            data: []
        }));

        const dataRowCount = jsonData.length - 1;
        const minIndex = offset;
        const maxIndex = offset + dataRowCount - 1;

        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;

            const dataIndex = i - 1;
            const xValue = (dataIndex + offset).toString();

            for (let col = 0; col < Math.min(row.length, columnCount); col++) {
                const yValue = parseFloat(row[col]);
                if (!isNaN(yValue)) {
                    datasets[col].data.push({ x: xValue, y: yValue });
                }
            }
        }

        results.push({ datasets, minIndex, maxIndex, fileName: sheetFileName });
    }

    if (results.length === 0) {
        throw new Error('Excelファイルに有効なデータシートがありません');
    }

    return results;
}

// ===========================
// UI関連関数
// ===========================

/**
 * ファイルリストを表示
 */
function displayFileList(files) {
    elements.fileListContainer.innerHTML = '';

    files.forEach((file) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item-control';

        const fileName = document.createElement('span');
        fileName.className = 'file-name';
        fileName.textContent = file.name;

        const offsetInput = document.createElement('input');
        offsetInput.type = 'number';
        offsetInput.className = 'offset-input';
        // fileOffsetsから現在のオフセット値を取得
        offsetInput.value = fileOffsets.get(file.name) || 0;
        offsetInput.step = '1';
        offsetInput.placeholder = '位置補正';
        offsetInput.dataset.fileName = file.name;

        offsetInput.addEventListener('input', async (e) => {
            const offset = parseInt(e.target.value) || 0;
            fileOffsets.set(file.name, offset);
            preserveZoom = true;
            await renderChartFromFiles();
        });

        fileItem.appendChild(fileName);
        fileItem.appendChild(offsetInput);
        elements.fileListContainer.appendChild(fileItem);
    });

    elements.controlsContainer.style.display = 'flex';
}

/**
 * 列選択UIを更新
 */
function updateColumnSelects(columnNames) {
    const currentXAxisValue = elements.xAxisSelect.value;
    const currentYAxisValues = elements.yAxisElements.map(el => el.columnSelect.value);
    const currentSmoothColumnValue = elements.smoothColumnSelect.value;

    // X軸select更新
    elements.xAxisSelect.innerHTML = '<option value="">なし</option>';
    Array.from(columnNames).sort().forEach(columnName => {
        const option = document.createElement('option');
        option.value = columnName;
        option.textContent = columnName;
        elements.xAxisSelect.appendChild(option);
    });

    if (currentXAxisValue && columnNames.has(currentXAxisValue)) {
        elements.xAxisSelect.value = currentXAxisValue;
    }

    // 移動平均列select更新
    elements.smoothColumnSelect.innerHTML = '<option value="">なし</option>';
    Array.from(columnNames).sort().forEach(columnName => {
        const option = document.createElement('option');
        option.value = columnName;
        option.textContent = columnName;
        elements.smoothColumnSelect.appendChild(option);
    });

    if (currentSmoothColumnValue && columnNames.has(currentSmoothColumnValue)) {
        elements.smoothColumnSelect.value = currentSmoothColumnValue;
    }

    // Y軸select更新
    elements.yAxisElements.forEach((elems, index) => {
        elems.columnSelect.innerHTML = '<option value="">なし</option>';
        Array.from(columnNames).sort().forEach(columnName => {
            const option = document.createElement('option');
            option.value = columnName;
            option.textContent = columnName;
            elems.columnSelect.appendChild(option);
        });

        if (currentYAxisValues[index] && columnNames.has(currentYAxisValues[index])) {
            elems.columnSelect.value = currentYAxisValues[index];
        }
    });
}

/**
 * 初期設定を適用
 */
function applyInitialSettings(columnNames) {
    // SPEEDを第2軸に設定
    const speedColumn = Array.from(columnNames).find(col => col === 'SPEED');
    if (speedColumn) {
        elements.yAxisElements[0].select.value = 'y2';
        elements.yAxisElements[0].columnSelect.value = speedColumn;
        elements.yAxisElements[0].typeSelect.value = 'line';
        yAxisConfigs[0].axis = 'y2';
        yAxisConfigs[0].chartType = 'line';
    }

    // POSFを含む列を第2軸に設定
    const posfColumn = Array.from(columnNames).find(col => col.includes('POSF'));
    if (posfColumn) {
        elements.yAxisElements[1].select.value = 'y2';
        elements.yAxisElements[1].check.checked = true;
        elements.yAxisElements[1].input.value = 'POSF';
        elements.yAxisElements[1].input.style.display = '';
        elements.yAxisElements[1].columnSelect.style.display = 'none';
        elements.yAxisElements[1].typeSelect.value = 'line';
        yAxisConfigs[1].enabled = true;
        yAxisConfigs[1].pattern = 'POSF';
        yAxisConfigs[1].axis = 'y2';
        yAxisConfigs[1].chartType = 'line';
    }
}

/**
 * 除外チェックボックスを更新
 */
function updateExcludeCheckboxes(columnNames, columnNameToColorFamily, fileDataToOriginalName, parsedData) {
    elements.excludeContainer.innerHTML = '';

    // 列名のチェックボックス
    Array.from(columnNames).sort().forEach(columnName => {
        const label = createExcludeLabel(columnName, columnNameToColorFamily, true);
        elements.excludeContainer.appendChild(label);
    });

    // ファイル/シート名のチェックボックス
    const addedFileNames = new Set();
    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (addedFileNames.has(originalFileName)) return;
        addedFileNames.add(originalFileName);

        const label = createExcludeLabel(originalFileName, null, false);
        elements.excludeContainer.appendChild(label);
    });
}

/**
 * 除外ラベルを作成
 */
function createExcludeLabel(name, columnNameToColorFamily, isColumn) {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '3px';
    label.style.cursor = 'pointer';
    label.style.whiteSpace = 'nowrap';
    label.style.padding = '2px 6px';
    label.style.borderRadius = '4px';

    if (isColumn && columnNameToColorFamily) {
        const colorFamilyIndex = columnNameToColorFamily.get(name) || 0;
        const representativeColor = COLOR_FAMILIES[colorFamilyIndex][0];
        label.style.backgroundColor = rgbToRgba(representativeColor, 0.3);
    } else {
        label.style.backgroundColor = 'rgba(128, 128, 128, 0.3)';
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = name;
    checkbox.checked = isColumn
        ? excludedColumns.includes(name)
        : excludedFiles.includes(name);

    checkbox.addEventListener('change', async (e) => {
        const targetArray = isColumn ? excludedColumns : excludedFiles;
        if (e.target.checked) {
            if (!targetArray.includes(name)) targetArray.push(name);
        } else {
            const index = targetArray.indexOf(name);
            if (index > -1) targetArray.splice(index, 1);
        }
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    const span = document.createElement('span');
    span.textContent = name;
    span.style.fontSize = '12px';
    span.style.fontWeight = '500';

    label.appendChild(checkbox);
    label.appendChild(span);
    return label;
}

// ===========================
// グラフ描画関連関数
// ===========================

/**
 * ファイルからグラフを描画
 */
async function renderChartFromFiles() {
    const parsedData = [];
    let minIndex = 0;
    let maxIndex = 0;

    // 全ファイルを解析
    for (let file of uploadedFiles) {
        try {
            const offset = fileOffsets.get(file.name) || 0;
            const fileName = file.name.toLowerCase();

            if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                const cleanName = file.name.replace(/\.(xlsx|xls)$/i, '');
                const results = await parseExcel(file, cleanName, offset);

                for (const result of results) {
                    parsedData.push(result);
                    if (result.minIndex < minIndex) minIndex = result.minIndex;
                    if (result.maxIndex > maxIndex) maxIndex = result.maxIndex;
                }
            } else {
                const text = await file.text();
                const cleanName = file.name.replace('.csv', '');
                const result = parseCSV(text, cleanName, offset);

                parsedData.push(result);
                if (result.minIndex < minIndex) minIndex = result.minIndex;
                if (result.maxIndex > maxIndex) maxIndex = result.maxIndex;
            }
        } catch (error) {
            console.error(`Error parsing ${file.name}:`, error);
            alert(`${file.name}の読み込みに失敗しました: ${error.message}`);
        }
    }

    // 列名とファイル名のマッピング
    const columnNames = new Set();
    const fileDataToOriginalName = new Map();

    uploadedFiles.forEach(file => {
        const cleanName = file.name.replace(/\.(csv|xlsx|xls)$/i, '');
        fileDataToOriginalName.set(cleanName, file.name);
    });

    parsedData.forEach(fileData => {
        const originalFile = uploadedFiles.find(f => {
            const cleanName = f.name.replace(/\.(csv|xlsx|xls)$/i, '');
            return fileData.fileName === cleanName || fileData.fileName.startsWith(cleanName + '_');
        });
        if (originalFile) {
            fileDataToOriginalName.set(fileData.fileName, originalFile.name);
        }

        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (!excludedFiles.includes(originalFileName)) {
            fileData.datasets.forEach(dataset => {
                const columnName = dataset.label.split(' - ')[1];
                if (columnName) columnNames.add(columnName);
            });
        }
    });

    // UI更新
    updateColumnSelects(columnNames);

    // 初回読み込み時の初期設定
    if (isInitialLoad) {
        applyInitialSettings(columnNames);
        isInitialLoad = false;
    }

    // 色系統の割り当て
    const columnNameToColorFamily = new Map();

    // 特定の列名に固定色を割り当て（見分けやすくするため）
    const fixedColorAssignments = {
        'X-TCMD': 0,  // 赤系
        'Y-TCMD': 1,  // 水色系
        'Z-TCMD': 3,  // 青系
        'S-TCMD': 2   // オレンジ系
    };

    let nextColorFamily = 0;
    Array.from(columnNames).sort().forEach(columnName => {
        if (fixedColorAssignments[columnName] !== undefined) {
            // 固定色が割り当てられている列名
            columnNameToColorFamily.set(columnName, fixedColorAssignments[columnName]);
        } else {
            // その他の列名は順番に割り当て（固定色と重複する場合はスキップ）
            const usedColors = new Set(Object.values(fixedColorAssignments));
            while (usedColors.has(nextColorFamily % COLOR_FAMILIES.length)) {
                nextColorFamily++;
            }
            columnNameToColorFamily.set(columnName, nextColorFamily % COLOR_FAMILIES.length);
            nextColorFamily++;
        }
    });

    updateExcludeCheckboxes(columnNames, columnNameToColorFamily, fileDataToOriginalName, parsedData);

    // データセット構築
    const datasets = buildDatasets(parsedData, fileDataToOriginalName, columnNameToColorFamily, minIndex, maxIndex);

    if (datasets.length > 0) {
        // メイングラフエリアを表示
        const chartsContainer = document.getElementById('chartsContainer');
        if (chartsContainer) {
            chartsContainer.style.display = 'flex';
        }

        renderChart(datasets);
        // 統計グラフを作成
        renderStatisticsCharts(parsedData, fileDataToOriginalName);
        // 統計グラフ更新用にキャッシュ
        cachedParsedData = parsedData;
        cachedFileDataToOriginalName = fileDataToOriginalName;
        // 統計エリアを表示
        const statisticsCard = document.getElementById('statisticsCard');
        if (statisticsCard) {
            statisticsCard.style.display = 'block';
        }
        // トルク変動率グラフを作成
        renderDerivativeChart(parsedData, fileDataToOriginalName);
        // トルク変動率エリアを表示
        const derivativeCard = document.getElementById('derivativeCard');
        if (derivativeCard) {
            derivativeCard.style.display = 'block';
        }
        // ファイル間比較解析エリアを表示
        const fileComparisonCard = document.getElementById('fileComparisonCard');
        if (fileComparisonCard) {
            fileComparisonCard.style.display = 'block';
        }
        // 3D散布図エリアを表示
        const simulation3dCard = document.getElementById('simulation3dCard');
        if (simulation3dCard) {
            simulation3dCard.removeAttribute('hidden');
        }
        // 3D散布図を作成
        init3DSimulation(parsedData, fileDataToOriginalName);
    }
}

/**
 * データセットを構築
 */
function buildDatasets(parsedData, fileDataToOriginalName, columnNameToColorFamily, minIndex, maxIndex) {
    const datasets = [];
    const thresholdViolations = [];
    const fileNameToIndex = new Map();

    let colorIndex = 0;
    parsedData.forEach(fileData => {
        fileNameToIndex.set(fileData.fileName, colorIndex);
        colorIndex++;
    });

    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        // X軸データを探す
        let xAxisData = null;
        const fileOffset = fileOffsets.get(originalFileName) || 0;

        if (xAxisPattern) {
            const xAxisDataset = fileData.datasets.find(dataset => {
                const columnName = dataset.label.split(' - ')[1] || '';
                return columnName === xAxisPattern;
            });
            if (xAxisDataset) {
                xAxisData = new Map();
                xAxisDataset.data.forEach(point => {
                    xAxisData.set(point.x, point.y + fileOffset);
                });
            }
        }

        fileData.datasets.forEach(dataset => {
            const columnName = dataset.label.split(' - ')[1] || '';

            // X軸列または除外列はスキップ
            if ((xAxisPattern && columnName === xAxisPattern) || excludedColumns.includes(columnName)) {
                return;
            }

            // データ変換
            const numericData = xAxisData
                ? dataset.data.map(point => ({
                    x: xAxisData.get(point.x) || parseInt(point.x),
                    y: point.y
                }))
                : dataset.data.map(point => ({
                    x: parseInt(point.x),
                    y: point.y
                }));

            const yAxisID = getYAxisID(dataset.label);
            const datasetChartType = getChartType(dataset.label);
            const colorFamilyIndex = columnNameToColorFamily.get(columnName) || 0;
            const fileIndex = fileNameToIndex.get(fileData.fileName) || 0;
            const colorFamily = COLOR_FAMILIES[colorFamilyIndex];
            const color = colorFamily[fileIndex % colorFamily.length];

            // データセット設定
            const datasetConfig = {
                type: datasetChartType,
                label: dataset.label,
                data: numericData,
                borderColor: color,
                backgroundColor: rgbToRgba(color, 0.1),
                tension: 0,
                borderWidth: 2,
                fill: false,
                spanGaps: true,
                yAxisID: yAxisID
            };

            // 散布図の場合は点を表示
            if (datasetChartType === 'scatter') {
                Object.assign(datasetConfig, {
                    pointRadius: 4,
                    pointHoverRadius: 4,
                    pointBackgroundColor: color,
                    pointBorderColor: color,
                    pointHoverBackgroundColor: color,
                    pointHoverBorderColor: color,
                    showLine: false
                });
            } else {
                datasetConfig.pointRadius = 0;
                datasetConfig.pointHoverRadius = 0;
            }

            datasets.push(datasetConfig);

            // 移動平均データセットを追加（選択された列の場合のみ）
            if (smoothColumnName && columnName === smoothColumnName && smoothWindow > 1) {
                const smoothedData = applyMovingAverage(numericData, smoothWindow);
                const smoothDatasetConfig = {
                    type: datasetChartType,
                    label: dataset.label + ' (移動平均)',
                    data: smoothedData,
                    borderColor: color,
                    backgroundColor: rgbToRgba(color, 0.1),
                    tension: 0,
                    borderWidth: 3,
                    fill: false,
                    spanGaps: true,
                    yAxisID: yAxisID,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    borderDash: [10, 5]
                };
                datasets.push(smoothDatasetConfig);
            }

            // 閾値違反の検出
            if (upperThresholdValue !== null || lowerThresholdValue !== null) {
                const violationData = numericData.filter(point => {
                    const exceedsUpper = upperThresholdValue !== null && point.y > upperThresholdValue;
                    const exceedsLower = lowerThresholdValue !== null && point.y < lowerThresholdValue;
                    return exceedsUpper || exceedsLower;
                });

                if (violationData.length > 0) {
                    thresholdViolations.push({
                        label: dataset.label + ' (閾値超過)',
                        data: violationData,
                        originalColor: color,
                        yAxisID: yAxisID,
                        chartType: datasetChartType
                    });
                }
            }
        });
    });

    // 閾値線を追加
    addThresholdLines(datasets, minIndex, maxIndex);

    // 閾値違反線を追加
    addViolationLines(datasets, thresholdViolations);

    return datasets;
}

/**
 * 閾値線を追加
 */
function addThresholdLines(datasets, minIndex, maxIndex) {
    const thresholds = [
        { value: upperThresholdValue, label: '上限閾値' },
        { value: lowerThresholdValue, label: '下限閾値' }
    ];

    thresholds.forEach(({ value, label }) => {
        if (value !== null) {
            datasets.push({
                type: 'line',
                label: label,
                data: [
                    { x: minIndex, y: value },
                    { x: maxIndex, y: value }
                ],
                borderColor: 'rgb(255, 0, 0)',
                backgroundColor: 'rgba(255, 0, 0, 0.1)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                tension: 0,
                yAxisID: 'y'
            });
        }
    });
}

/**
 * 閾値違反線を追加
 */
function addViolationLines(datasets, thresholdViolations) {
    thresholdViolations.forEach(violation => {
        const violationConfig = {
            type: violation.chartType,
            label: violation.label,
            data: violation.data,
            borderColor: 'rgb(255, 0, 0)',
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            tension: 0,
            borderWidth: 3,
            fill: false,
            spanGaps: false,
            isViolation: true,
            yAxisID: violation.yAxisID
        };

        if (violation.chartType === 'scatter') {
            Object.assign(violationConfig, {
                pointRadius: 6,
                pointHoverRadius: 6,
                pointBackgroundColor: 'rgb(255, 0, 0)',
                pointBorderColor: 'rgb(255, 0, 0)',
                pointHoverBackgroundColor: 'rgb(255, 0, 0)',
                pointHoverBorderColor: 'rgb(255, 0, 0)',
                showLine: false
            });
        } else {
            violationConfig.pointRadius = 0;
            violationConfig.pointHoverRadius = 0;
        }

        datasets.push(violationConfig);
    });
}

/**
 * グラフを描画
 */
function renderChart(datasets) {
    const ctx = document.getElementById('myChart').getContext('2d');

    // 表示状態を保存
    if (chart && preserveZoom) {
        chart.data.datasets.forEach((dataset, index) => {
            const meta = chart.getDatasetMeta(index);
            datasetVisibility.set(dataset.label, !meta.hidden);
        });
    }

    // データ範囲を計算
    const ranges = calculateDataRanges(datasets);

    if (chart) {
        chart.destroy();
    }

    // 使用軸の判定
    const usedAxes = new Set();
    datasets.forEach(dataset => {
        if (dataset.yAxisID) usedAxes.add(dataset.yAxisID);
    });

    // グラフ作成
    chart = new Chart(ctx, {
        type: chartType,
        data: { datasets },
        options: createChartOptions(usedAxes),
        plugins: [createDataRangePlugin()]
    });

    // ズーム制限を設定
    updateZoomLimits(ranges);

    // 表示状態を復元
    restoreDatasetVisibility();

    preserveZoom = true;
    elements.resetZoomBtn.style.display = 'inline-block';
    elements.exportCsvBtn.style.display = 'inline-block';

    // スクロールバーの表示/非表示は updateScrollbarsFromChart() で自動判定される

    // 閾値違反の点滅を開始
    startBlinking(datasets);

    // メイングラフをアクティブにする
    activeChart = 'main';
}

/**
 * データ範囲を計算
 */
function calculateDataRanges(datasets) {
    const ranges = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minY2: Infinity, maxY2: -Infinity,
        minY3: Infinity, maxY3: -Infinity,
        minY4: Infinity, maxY4: -Infinity
    };

    datasets.forEach(dataset => {
        dataset.data.forEach(point => {
            if (point.x < ranges.minX) ranges.minX = point.x;
            if (point.x > ranges.maxX) ranges.maxX = point.x;

            // Y軸ごとに範囲を記録
            if (dataset.yAxisID === 'y') {
                if (point.y < ranges.minY) ranges.minY = point.y;
                if (point.y > ranges.maxY) ranges.maxY = point.y;
            } else if (dataset.yAxisID === 'y2') {
                if (point.y < ranges.minY2) ranges.minY2 = point.y;
                if (point.y > ranges.maxY2) ranges.maxY2 = point.y;
            } else if (dataset.yAxisID === 'y3') {
                if (point.y < ranges.minY3) ranges.minY3 = point.y;
                if (point.y > ranges.maxY3) ranges.maxY3 = point.y;
            } else if (dataset.yAxisID === 'y4') {
                if (point.y < ranges.minY4) ranges.minY4 = point.y;
                if (point.y > ranges.maxY4) ranges.maxY4 = point.y;
            }
        });
    });

    return ranges;
}

/**
 * Chart.jsオプションを作成
 */
function createChartOptions(usedAxes) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 200,
        animation: false,
        plugins: {
            decimation: {
                enabled: true,
                algorithm: 'lttb',
                samples: 400
            },
            legend: {
                display: true,
                position: 'top',
                labels: {
                    usePointStyle: true,
                    padding: 12,
                    font: { size: 12 }
                },
                onClick: handleLegendClick
            },
            tooltip: {
                enabled: tooltipEnabled,
                mode: tooltipSingleMode ? 'nearest' : 'index',
                intersect: false,
                axis: tooltipSingleMode ? 'xy' : 'x',
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 12,
                titleFont: { size: 14 },
                bodyFont: { size: 13 },
                callbacks: {
                    title: function(context) {
                        if (tooltipSingleMode && context.length > 0) {
                            return `時刻: ${context[0].parsed.x}`;
                        }
                        return '';
                    },
                    label: function(context) {
                        if (tooltipSingleMode) {
                            return `${context.dataset.label}: ${context.parsed.y}`;
                        }
                        return `${context.dataset.label}: ${context.parsed.y}`;
                    }
                }
            },
            zoom: {
                zoom: {
                    wheel: { enabled: true },
                    drag: {
                        enabled: true,
                        backgroundColor: 'rgba(102, 126, 234, 0.3)',
                        borderColor: 'rgba(102, 126, 234, 1)',
                        borderWidth: 2,
                        threshold: 50,
                        drawTime: 'afterDatasetsDraw'
                    },
                    mode: 'xy',
                    onZoomComplete: function() {
                        saveCurrentZoomState();
                    }
                },
                pan: {
                    enabled: true,
                    mode: 'xy',
                    modifierKey: 'shift',
                    onPanComplete: function() {
                        saveCurrentZoomState();
                    }
                },
                limits: {
                    x: {min: 'original', max: 'original'},
                    y: {min: 'original', max: 'original'}
                }
            }
        },
        scales: createScalesConfig(usedAxes),
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        }
    };
}

/**
 * データ範囲ハッチングプラグインを作成
 */
function createDataRangePlugin() {
    return {
        id: 'dataRangePlugin',
        afterDatasetsDraw: (chart) => {
            const ctx = chart.ctx;
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;

            if (!xScale || !yScale) return;

            // 無負荷時データ範囲（薄い青透明）
            if (noLoadStartValue !== null && noLoadEndValue !== null) {
                const xStart = xScale.getPixelForValue(noLoadStartValue);
                const xEnd = xScale.getPixelForValue(noLoadEndValue);

                ctx.save();
                ctx.fillStyle = 'rgba(135, 206, 250, 0.2)'; // 薄い青透明
                ctx.fillRect(xStart, yScale.top, xEnd - xStart, yScale.bottom - yScale.top);

                // エッジライン（ドラッグ可能領域を視覚化）
                ctx.strokeStyle = 'rgba(37, 99, 235, 0.6)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(xStart, yScale.top);
                ctx.lineTo(xStart, yScale.bottom);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(xEnd, yScale.top);
                ctx.lineTo(xEnd, yScale.bottom);
                ctx.stroke();

                ctx.restore();
            }

            // 解析データ範囲（薄いピンク透明）
            if (analysisStartValue !== null && analysisEndValue !== null) {
                const xStart = xScale.getPixelForValue(analysisStartValue);
                const xEnd = xScale.getPixelForValue(analysisEndValue);

                ctx.save();
                ctx.fillStyle = 'rgba(255, 182, 193, 0.2)'; // 薄いピンク透明
                ctx.fillRect(xStart, yScale.top, xEnd - xStart, yScale.bottom - yScale.top);

                // エッジライン（ドラッグ可能領域を視覚化）
                ctx.strokeStyle = 'rgba(220, 38, 38, 0.6)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(xStart, yScale.top);
                ctx.lineTo(xStart, yScale.bottom);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(xEnd, yScale.top);
                ctx.lineTo(xEnd, yScale.bottom);
                ctx.stroke();

                ctx.restore();
            }
        }
    };
}

/**
 * マウス位置がデータ範囲のエッジ付近にあるかチェック
 */
function detectRangeEdge(mouseX) {
    if (!chart || !chart.scales.x) return null;

    const xScale = chart.scales.x;

    // 無負荷時データ範囲のエッジ
    if (noLoadStartValue !== null && noLoadEndValue !== null) {
        const noLoadStartPixel = xScale.getPixelForValue(noLoadStartValue);
        const noLoadEndPixel = xScale.getPixelForValue(noLoadEndValue);

        if (Math.abs(mouseX - noLoadStartPixel) <= EDGE_DETECTION_THRESHOLD) {
            return 'noLoadStart';
        }
        if (Math.abs(mouseX - noLoadEndPixel) <= EDGE_DETECTION_THRESHOLD) {
            return 'noLoadEnd';
        }
    }

    // 解析データ範囲のエッジ
    if (analysisStartValue !== null && analysisEndValue !== null) {
        const analysisStartPixel = xScale.getPixelForValue(analysisStartValue);
        const analysisEndPixel = xScale.getPixelForValue(analysisEndValue);

        if (Math.abs(mouseX - analysisStartPixel) <= EDGE_DETECTION_THRESHOLD) {
            return 'analysisStart';
        }
        if (Math.abs(mouseX - analysisEndPixel) <= EDGE_DETECTION_THRESHOLD) {
            return 'analysisEnd';
        }
    }

    return null;
}

/**
 * データ範囲エッジのドラッグ処理を設定
 */
function setupRangeEdgeDragging() {
    const chartCanvas = document.getElementById('myChart');
    if (!chartCanvas) return;

    // チャートキャンバス上でのマウス移動（カーソル変更とドラッグ中の更新）
    chartCanvas.addEventListener('mousemove', (e) => {
        if (isDraggingRangeEdge) {
            // ドラッグ中
            updateRangeEdgePosition(e.clientX);
        } else {
            // カーソル変更
            const rect = chartCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const edgeType = detectRangeEdge(mouseX);

            if (edgeType) {
                chartCanvas.style.cursor = 'ew-resize'; // 左右矢印
            } else {
                chartCanvas.style.cursor = 'default';
            }
        }
    });

    // ドキュメント全体でのマウス移動（ドラッグ中のみ）
    document.addEventListener('mousemove', (e) => {
        if (isDraggingRangeEdge) {
            updateRangeEdgePosition(e.clientX);
            // カーソルを維持
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
        }
    });

    // マウスダウンでドラッグ開始
    chartCanvas.addEventListener('mousedown', (e) => {
        const rect = chartCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const edgeType = detectRangeEdge(mouseX);

        if (edgeType) {
            isDraggingRangeEdge = true;
            draggingEdgeType = edgeType;
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
            e.stopPropagation();
        }
    }, true); // キャプチャフェーズで処理

    // マウスアップでドラッグ終了
    const handleMouseUp = async () => {
        if (isDraggingRangeEdge) {
            // 解析範囲が変更されたかどうかを先に保存
            const wasAnalysisRange = (draggingEdgeType === 'analysisStart' || draggingEdgeType === 'analysisEnd');

            isDraggingRangeEdge = false;
            draggingEdgeType = null;
            document.body.style.cursor = 'default';

            // モーダルの入力フィールドも更新
            updateModalInputs();

            // 散布図を更新
            await createScatterPlot();

            // 解析範囲が変更された場合は統計グラフも更新
            if (wasAnalysisRange && cachedParsedData.length > 0) {
                renderStatisticsCharts(cachedParsedData, cachedFileDataToOriginalName);
            }
        }
    };

    chartCanvas.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseup', handleMouseUp);

    // マウスがキャンバスから出た場合
    chartCanvas.addEventListener('mouseleave', () => {
        if (!isDraggingRangeEdge) {
            chartCanvas.style.cursor = 'default';
        }
    });
}

/**
 * ドラッグ中に範囲エッジの位置を更新
 */
function updateRangeEdgePosition(clientX) {
    const chartCanvas = document.getElementById('myChart');
    if (!chartCanvas || !chart || !chart.scales.x) return;

    const rect = chartCanvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const xScale = chart.scales.x;
    const newValue = Math.round(xScale.getValueForPixel(mouseX));

    // 値を更新
    if (draggingEdgeType === 'noLoadStart') {
        noLoadStartValue = Math.min(newValue, noLoadEndValue - 1);
    } else if (draggingEdgeType === 'noLoadEnd') {
        noLoadEndValue = Math.max(newValue, noLoadStartValue + 1);
    } else if (draggingEdgeType === 'analysisStart') {
        analysisStartValue = Math.min(newValue, analysisEndValue - 1);
    } else if (draggingEdgeType === 'analysisEnd') {
        analysisEndValue = Math.max(newValue, analysisStartValue + 1);
    }

    // グラフを更新
    if (chart) {
        chart.update('none');
    }
}

/**
 * モーダルの入力フィールドを更新
 */
function updateModalInputs() {
    document.getElementById('noLoadStart').value = noLoadStartValue || '';
    document.getElementById('noLoadEnd').value = noLoadEndValue || '';
    document.getElementById('analysisStart').value = analysisStartValue || '';
    document.getElementById('analysisEnd').value = analysisEndValue || '';
}

/**
 * スケール設定を作成
 */
function createScalesConfig(usedAxes) {
    const scales = {
        x: {
            type: 'linear',
            display: true,
            min: savedZoomState && preserveZoom ? savedZoomState.x.min : undefined,
            max: savedZoomState && preserveZoom ? savedZoomState.x.max : undefined,
            title: { display: false },
            ticks: { display: true },
            grid: { display: true, color: 'rgba(0, 0, 0, 0.05)' }
        },
        y: {
            display: true,
            position: 'left',
            min: savedZoomState && preserveZoom ? savedZoomState.y.min : undefined,
            max: savedZoomState && preserveZoom ? savedZoomState.y.max : undefined,
            title: { display: false },
            grid: { display: true, color: 'rgba(0, 0, 0, 0.05)' }
        }
    };

    ['y2', 'y3', 'y4'].forEach(axis => {
        scales[axis] = {
            display: usedAxes.has(axis),
            position: 'right',
            min: savedZoomState && preserveZoom && savedZoomState[axis] ? savedZoomState[axis].min : undefined,
            max: savedZoomState && preserveZoom && savedZoomState[axis] ? savedZoomState[axis].max : undefined,
            title: { display: false },
            grid: { display: false }
        };
    });

    return scales;
}

/**
 * 凡例クリックハンドラ
 */
function handleLegendClick(_e, legendItem, legend) {
    const index = legendItem.datasetIndex;
    const ci = legend.chart;

    if (ci.isDatasetVisible(index)) {
        ci.hide(index);
        legendItem.hidden = true;
    } else {
        ci.show(index);
        legendItem.hidden = false;
    }

    setTimeout(() => {
        if (ci.scales && ci.scales.x && ci.scales.y) {
            saveCurrentZoomState();
        }
    }, 50);
}

/**
 * ズーム制限を更新
 */
function updateZoomLimits(ranges) {
    if (!chart.options.plugins.zoom.limits) return;

    const xMargin = (ranges.maxX - ranges.minX) * 0.1;
    chart.options.plugins.zoom.limits.x = {
        min: ranges.minX - xMargin,
        max: ranges.maxX + xMargin
    };

    const yAxes = ['y', 'y2', 'y3', 'y4'];
    yAxes.forEach(axis => {
        const minKey = `min${axis === 'y' ? 'Y' : axis.toUpperCase()}`;
        const maxKey = `max${axis === 'y' ? 'Y' : axis.toUpperCase()}`;

        if (ranges[minKey] !== Infinity && ranges[maxKey] !== -Infinity) {
            const margin = (ranges[maxKey] - ranges[minKey]) * 0.1;
            chart.options.plugins.zoom.limits[axis] = {
                min: ranges[minKey] - margin,
                max: ranges[maxKey] + margin
            };
        }
    });
}

/**
 * データセット表示状態を復元
 */
function restoreDatasetVisibility() {
    if (datasetVisibility.size === 0) return;

    chart.data.datasets.forEach((dataset, index) => {
        if (datasetVisibility.has(dataset.label)) {
            const isVisible = datasetVisibility.get(dataset.label);
            const meta = chart.getDatasetMeta(index);
            meta.hidden = !isVisible;
        }
    });
    chart.update('none');
}

/**
 * 閾値違反の点滅を開始
 */
function startBlinking() {
    if (blinkTimer) {
        clearInterval(blinkTimer);
    }

    const violationIndices = [];
    chart.data.datasets.forEach((dataset, index) => {
        if (dataset.isViolation) {
            violationIndices.push(index);
        }
    });

    if (violationIndices.length > 0) {
        blinkTimer = setInterval(() => {
            blinkState = !blinkState;
            violationIndices.forEach(index => {
                const dataset = chart.data.datasets[index];
                dataset.borderColor = blinkState
                    ? 'rgb(255, 0, 0)'
                    : 'rgba(255, 0, 0, 0.2)';
            });
            chart.update('none');
        }, BLINK_INTERVAL);
    }
}

/**
 * CSV出力
 */
function exportChartDataToCsv() {
    if (!chart || !chart.data.datasets || chart.data.datasets.length === 0) {
        alert('出力するデータがありません');
        return;
    }

    const datasets = chart.data.datasets;
    const xScale = chart.scales.x;
    const minX = Math.floor(xScale.min);
    const maxX = Math.ceil(xScale.max);

    // 表示範囲内のX座標を収集
    const xValues = new Set();
    datasets.forEach(dataset => {
        if (dataset.data && Array.isArray(dataset.data)) {
            dataset.data.forEach(point => {
                if (point && typeof point === 'object' && point.x >= minX && point.x <= maxX) {
                    xValues.add(point.x);
                }
            });
        }
    });

    const sortedX = Array.from(xValues).sort((a, b) => a - b);

    if (sortedX.length === 0) {
        alert('表示範囲内にデータがありません');
        return;
    }

    // CSVヘッダー
    let csvContent = 'index';
    datasets.forEach(dataset => {
        const columnName = dataset.label.split(' - ')[1] || dataset.label;
        csvContent += ',' + columnName;
    });
    csvContent += '\n';

    // データ行
    sortedX.forEach(x => {
        csvContent += x;
        datasets.forEach(dataset => {
            const point = dataset.data.find(p => p && p.x === x);
            const value = point ? point.y : '';
            csvContent += ',' + value;
        });
        csvContent += '\n';
    });

    // ダウンロード
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const timestamp = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    const filename = `graph_data_${timestamp}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ===========================
// キーボード操作
// ===========================

/**
 * 連続パンを実行
 */
function continuousPan() {
    // アクティブなグラフに応じて操作対象を決定
    const targetChart = activeChart === 'main' ? chart :
                       activeChart === 'derivative' ? derivativeChart : null;

    if (!targetChart) return;

    // 入力フィールドから現在の速度を取得
    const speedX = parseFloat(elements.panSpeedXInput.value) || PAN_SPEED_X;
    const speedY = parseFloat(elements.panSpeedYInput.value) || PAN_SPEED_Y;

    if (keysPressed.ArrowRight) panAxisForChart(targetChart, 'x', -speedX);
    if (keysPressed.ArrowLeft) panAxisForChart(targetChart, 'x', speedX);
    if (keysPressed.ArrowUp) panAxisForChart(targetChart, 'y', speedY);
    if (keysPressed.ArrowDown) panAxisForChart(targetChart, 'y', -speedY);

    if (keysPressed.ArrowRight || keysPressed.ArrowLeft ||
        keysPressed.ArrowUp || keysPressed.ArrowDown) {
        animationFrameId = requestAnimationFrame(continuousPan);
    }
}

// ===========================
// トルク変動率解析
// ===========================

/**
 * トルク変動率グラフを作成
 */
function renderDerivativeChart(parsedData, fileDataToOriginalName) {
    const ctx = document.getElementById('derivativeChart');
    if (!ctx) return;

    // 既存のチャートがあれば破棄
    if (derivativeChart) {
        derivativeChart.destroy();
    }

    const datasets = [];

    // ファイルごとに異なる色を割り当て
    const fileColors = [
        'rgb(220, 38, 38)',     // 赤
        'rgb(59, 130, 246)',    // 青
        'rgb(234, 88, 12)',     // オレンジ
        'rgb(22, 163, 74)',     // 緑
        'rgb(147, 51, 234)',    // 紫
        'rgb(8, 145, 178)',     // シアン
        'rgb(234, 179, 8)',     // 黄
        'rgb(219, 39, 119)'     // ピンク
    ];

    // Z-TCMDの変動率を計算
    parsedData.forEach((fileData, fileIndex) => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        // Z-TCMDデータを取得
        const zTcmdDataset = fileData.datasets.find(ds => ds.label.includes('Z-TCMD'));
        if (!zTcmdDataset || !zTcmdDataset.data || zTcmdDataset.data.length < 2) return;

        const derivativeData = [];

        // 変動率を計算（微分）
        for (let i = 1; i < zTcmdDataset.data.length; i++) {
            const current = zTcmdDataset.data[i].y;
            const previous = zTcmdDataset.data[i - 1].y;
            const derivative = current - previous;

            derivativeData.push({
                x: zTcmdDataset.data[i].x,
                y: derivative
            });
        }

        // ファイルごとに異なる色を割り当て
        const colorIndex = fileIndex % fileColors.length;
        const color = fileColors[colorIndex];

        datasets.push({
            label: `${originalFileName} - Z-TCMD変動率`,
            data: derivativeData,
            borderColor: color,
            backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.1)'),
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0,
            fill: false
        });
    });

    if (datasets.length === 0) return;

    derivativeChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    enabled: tooltipEnabled,
                    mode: tooltipSingleMode ? 'nearest' : 'index',
                    intersect: false,
                    axis: 'x',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: { size: 14 },
                    bodyFont: { size: 13 },
                    callbacks: {
                        title: function(context) {
                            if (tooltipSingleMode && context.length > 0) {
                                return `データポイント: ${context[0].parsed.x}`;
                            }
                            return '';
                        },
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y}`;
                        }
                    }
                },
                zoom: {
                    zoom: {
                        wheel: { enabled: true },
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(102, 126, 234, 0.3)',
                            borderColor: 'rgba(102, 126, 234, 1)',
                            borderWidth: 2,
                            threshold: 50,
                            drawTime: 'afterDatasetsDraw'
                        },
                        mode: 'xy'
                    },
                    pan: {
                        enabled: true,
                        mode: 'xy',
                        modifierKey: 'shift'
                    },
                    limits: {
                        x: { min: 'original', max: 'original' },
                        y: { min: 'original', max: 'original' }
                    }
                },
                annotation: {
                    annotations: {
                        zeroLine: {
                            type: 'line',
                            yMin: 0,
                            yMax: 0,
                            borderColor: 'rgba(0, 0, 0, 0.5)',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            label: {
                                display: true,
                                content: '変化なし',
                                position: 'end'
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'データポイント'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '変動率（負荷変化量）'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                }
            }
        }
    });
}

// ===========================
// イベントリスナー設定
// ===========================

/**
 * 統計グラフを作成
 */
function renderStatisticsCharts(parsedData, fileDataToOriginalName) {
    const statistics = calculateStatistics(parsedData, fileDataToOriginalName);

    // 移動平均からの絶対値積算グラフ
    createBarChart('deviationChart', statistics.deviation, deviationChart);

    // 平均値グラフ
    createBarChart('averageChart', statistics.average, averageChart);

    // 最大値グラフ
    createBarChart('maxChart', statistics.max, maxChart);

    // 適合率を計算して表示
    const conformityRates = calculateConformityRates(parsedData, fileDataToOriginalName);
    displayConformityRates(conformityRates);

    // 位置-負荷相関分析を実行
    analyzePositionLoadCorrelation(parsedData, fileDataToOriginalName);

    // 位置別負荷ヒートマップを描画
    drawPositionLoadHeatmap(parsedData, fileDataToOriginalName);

    // セグメント別分析を実行
    analyzeSegments(parsedData, fileDataToOriginalName);
}

/**
 * 統計グラフの凡例/ツールチップ設定を更新
 */
function updateStatisticsChartsOptions() {
    const charts = [deviationChart, averageChart, maxChart];

    charts.forEach(chart => {
        if (chart) {
            chart.options.plugins.legend.display = tooltipEnabled;
            chart.options.plugins.tooltip.enabled = tooltipEnabled;
            chart.options.plugins.tooltip.mode = tooltipSingleMode ? 'nearest' : 'index';
            chart.options.plugins.tooltip.intersect = tooltipSingleMode ? true : false;
            chart.options.plugins.tooltip.axis = tooltipSingleMode ? 'xy' : 'x';
            chart.update('none');
        }
    });
}

/**
 * トルク変動率グラフのツールチップ設定を更新（凡例は常に表示）
 */
function updateDerivativeChartOptions() {
    if (derivativeChart) {
        // 凡例は常に表示（display: trueのまま）
        derivativeChart.options.plugins.tooltip.enabled = tooltipEnabled;
        derivativeChart.options.plugins.tooltip.mode = tooltipSingleMode ? 'nearest' : 'index';
        derivativeChart.options.plugins.tooltip.intersect = tooltipSingleMode ? true : false;
        derivativeChart.options.plugins.tooltip.axis = tooltipSingleMode ? 'xy' : 'x';
        derivativeChart.update('none');
    }
}

/**
 * 散布図のツールチップ設定を更新（凡例は常に表示）
 */
function updateScatterChartOptions() {
    if (scatterChart) {
        // 凡例は常に表示（display: trueのまま）
        scatterChart.options.plugins.tooltip.enabled = tooltipEnabled;
        scatterChart.options.plugins.tooltip.mode = tooltipSingleMode ? 'nearest' : 'index';
        scatterChart.options.plugins.tooltip.axis = tooltipSingleMode ? 'xy' : 'x';
        scatterChart.update('none');
    }
}

/**
 * 相関係数を計算
 */
function calculateCorrelation(array1, array2) {
    if (array1.length !== array2.length || array1.length === 0) return 0;

    const n = array1.length;
    const mean1 = array1.reduce((sum, val) => sum + val, 0) / n;
    const mean2 = array2.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let sumSq1 = 0;
    let sumSq2 = 0;

    for (let i = 0; i < n; i++) {
        const diff1 = array1[i] - mean1;
        const diff2 = array2[i] - mean2;
        numerator += diff1 * diff2;
        sumSq1 += diff1 * diff1;
        sumSq2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(sumSq1 * sumSq2);
    if (denominator === 0) return 0;

    return numerator / denominator;
}

/**
 * 波形特徴量を計算
 */
function calculateWaveformFeatures(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) {
        return { max: 0, min: 0, avg: 0, std: 0, cv: 0, peakIndex: 0 };
    }

    const values = dataPoints.map(p => p.y);

    // 最大値・最小値
    const max = Math.max(...values);
    const min = Math.min(...values);

    // 平均値
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;

    // 標準偏差
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const std = Math.sqrt(variance);

    // 変動係数（CV: Coefficient of Variation）
    const cv = avg !== 0 ? (std / Math.abs(avg)) * 100 : 0;

    // ピーク位置（絶対値最大の位置）
    let peakIndex = 0;
    let maxAbs = 0;
    values.forEach((val, idx) => {
        if (Math.abs(val) > maxAbs) {
            maxAbs = Math.abs(val);
            peakIndex = idx;
        }
    });

    return { max, min, avg, std, cv, peakIndex: dataPoints[peakIndex].x };
}

/**
 * 定数: 適合率計算用パラメータ
 */
const CONFORMITY_CONFIG = {
    TARGET_COLUMNS: ['X-TCMD', 'Y-TCMD', 'Z-TCMD', 'S-TCMD'],
    MEAN_DIFF_WEIGHT: 20,  // 平均値差の重み係数
    CORRELATION_WEIGHT: 0.3,  // 相関係数の重み
    RMSE_WEIGHT: 0.7  // RMSEの重み
};

/**
 * 修正RMSEを計算（平均値差を考慮）
 */
function calculateModifiedRMSE(fileValues, avgValues) {
    // 平均値の差を計算
    const fileMean = fileValues.reduce((sum, val) => sum + val, 0) / fileValues.length;
    const avgMean = avgValues.reduce((sum, val) => sum + val, 0) / avgValues.length;
    const meanDiff = Math.abs(fileMean - avgMean);

    // 通常のRMSE
    let sumSquaredError = 0;
    for (let i = 0; i < fileValues.length; i++) {
        const error = fileValues[i] - avgValues[i];
        sumSquaredError += error * error;
    }
    const rmse = Math.sqrt(sumSquaredError / fileValues.length);

    // 修正RMSE = √(RMSE² + (平均値差 × 重み係数)²)
    const rmseModified = Math.sqrt(
        rmse * rmse +
        (meanDiff * CONFORMITY_CONFIG.MEAN_DIFF_WEIGHT) * (meanDiff * CONFORMITY_CONFIG.MEAN_DIFF_WEIGHT)
    );

    return { rmseModified, rmse, meanDiff, fileMean, avgMean };
}

/**
 * Leave-One-Out方式で平均パターンを計算
 */
function calculateLeaveOneOutAverages(fileDataMap, sortedXIndices, targetColumns) {
    const averageByXByFile = new Map();
    const fileNames = Array.from(fileDataMap.keys());

    fileNames.forEach(targetFileName => {
        const averageByX = new Map();

        sortedXIndices.forEach(xIndex => {
            const columnAverages = new Map();

            targetColumns.forEach(columnName => {
                const values = [];
                fileDataMap.forEach((columnMap, fileName) => {
                    // 評価対象ファイルを除外して平均を計算
                    if (fileName !== targetFileName && columnMap.has(columnName)) {
                        const yValue = columnMap.get(columnName).get(xIndex);
                        if (yValue !== undefined) {
                            values.push(yValue);
                        }
                    }
                });

                if (values.length > 0) {
                    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
                    columnAverages.set(columnName, avg);
                }
            });

            averageByX.set(xIndex, columnAverages);
        });

        averageByXByFile.set(targetFileName, averageByX);
    });

    return averageByXByFile;
}

/**
 * 軸ごとの適合率を計算
 */
function calculateAxisConformityRate(correlation, rmse, maxRmse) {
    // 相関係数スコア (0-100)
    const correlationScore = Math.max(0, Math.min(100, correlation * 100));

    // RMSEスコア (0-100, 小さいほど高得点)
    const normalizedRmse = rmse / maxRmse;
    const rmseScore = Math.max(0, (1 - normalizedRmse) * 100);

    // 組み合わせ（相関30% + RMSE70%）
    const rate = correlationScore * CONFORMITY_CONFIG.CORRELATION_WEIGHT +
                 rmseScore * CONFORMITY_CONFIG.RMSE_WEIGHT;

    return { rate, correlationScore, rmseScore };
}

/**
 * 適合率を計算（相関係数ベース）
 */
function calculateConformityRates(parsedData, fileDataToOriginalName) {
    const targetColumns = CONFORMITY_CONFIG.TARGET_COLUMNS;

    // ファイルごとのデータを整理（オフセット適用済み、Map化して高速検索）
    const fileDataMap = new Map(); // Map<fileName, Map<columnName, Map<x, y>>>

    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        if (!fileDataMap.has(originalFileName)) {
            fileDataMap.set(originalFileName, new Map());
        }

        // オフセット値を取得
        const fileOffset = fileOffsets.get(originalFileName) || 0;

        fileData.datasets.forEach(dataset => {
            const columnName = dataset.label.split(' - ')[1] || '';
            if (!targetColumns.includes(columnName)) return;
            if (xAxisPattern && columnName === xAxisPattern) return;
            if (excludedColumns.includes(columnName)) return;

            // オフセットを適用し、MapでX軸→Y値の高速検索を可能に
            const dataMap = new Map();
            dataset.data.forEach(point => {
                const xWithOffset = parseInt(point.x) + fileOffset;
                dataMap.set(xWithOffset, point.y);
            });

            fileDataMap.get(originalFileName).set(columnName, dataMap);
        });
    });

    // X軸の全インデックスを収集
    const allXIndices = new Set();
    fileDataMap.forEach(columnMap => {
        columnMap.forEach(dataMap => {
            dataMap.forEach((_, x) => allXIndices.add(x));
        });
    });
    const sortedXIndices = Array.from(allXIndices).sort((a, b) => a - b);

    // Leave-One-Out方式で平均パターンを計算
    const averageByXByFile = calculateLeaveOneOutAverages(fileDataMap, sortedXIndices, targetColumns);

    // ファイルごとに適合率と波形特徴量を計算
    const conformityRates = [];
    const rmseByAxis = {}; // 軸ごとの全ファイルのRMSEを収集（正規化用）

    // 第1パス: 相関係数とRMSEを計算
    const tempResults = [];
    fileDataMap.forEach((columnMap, fileName) => {
        const correlationsByAxis = {};  // 軸ごとの相関係数
        const rmsesByAxis = {};  // 軸ごとのRMSE
        const features = {
            zTcmd: null  // Z-TCMDの特徴量（負荷の代表として使用）
        };

        // このファイルの平均パターン（Leave-One-Out）を取得
        const averageByX = averageByXByFile.get(fileName);
        if (!averageByX) return;

        targetColumns.forEach(columnName => {
            if (!columnMap.has(columnName)) return;

            const dataMap = columnMap.get(columnName);
            const fileValues = [];
            const avgValues = [];

            // Map化されたデータを使用して高速検索
            sortedXIndices.forEach(xIndex => {
                const avgValue = averageByX.get(xIndex)?.get(columnName);
                const yValue = dataMap.get(xIndex);

                if (yValue !== undefined && avgValue !== undefined) {
                    fileValues.push(yValue);
                    avgValues.push(avgValue);
                }
            });

            if (fileValues.length > 0) {
                // 相関係数を計算
                const correlation = calculateCorrelation(fileValues, avgValues);
                correlationsByAxis[columnName] = correlation;

                // 修正RMSEを計算
                const { rmseModified } = calculateModifiedRMSE(fileValues, avgValues);
                rmsesByAxis[columnName] = rmseModified;

                // 軸ごとのRMSEを収集（正規化用）
                if (!rmseByAxis[columnName]) {
                    rmseByAxis[columnName] = [];
                }
                rmseByAxis[columnName].push(rmseModified);
            }

            // Z-TCMDの波形特徴量を計算（Map→Array変換）
            if (columnName === 'Z-TCMD' && columnMap.has(columnName)) {
                const dataArray = Array.from(dataMap.entries()).map(([x, y]) => ({ x, y }));
                features.zTcmd = calculateWaveformFeatures(dataArray);
            }
        });

        tempResults.push({
            fileName: fileName,
            correlationsByAxis: correlationsByAxis,
            rmsesByAxis: rmsesByAxis,
            features: features
        });
    });

    // 第2パス: RMSEを正規化して適合率を計算
    const maxRmseByAxis = {};
    targetColumns.forEach(columnName => {
        if (rmseByAxis[columnName] && rmseByAxis[columnName].length > 0) {
            maxRmseByAxis[columnName] = Math.max(...rmseByAxis[columnName], 0.01);
        }
    });

    tempResults.forEach(result => {
        const { fileName, correlationsByAxis, rmsesByAxis, features } = result;

        // 各軸の適合率を計算
        const calculateAxisRate = (columnName) => {
            if (correlationsByAxis[columnName] === undefined) return null;

            const correlation = correlationsByAxis[columnName];
            const rmse = rmsesByAxis[columnName];
            const maxRmse = maxRmseByAxis[columnName];

            const { rate } = calculateAxisConformityRate(correlation, rmse, maxRmse);
            return rate;
        };

        const xRate = calculateAxisRate('X-TCMD');
        const yRate = calculateAxisRate('Y-TCMD');
        const zRate = calculateAxisRate('Z-TCMD');
        const sRate = calculateAxisRate('S-TCMD');

        // 4軸の適合率の平均を適合率（計）とする
        const rates = [xRate, yRate, zRate, sRate].filter(r => r !== null);
        const conformityRate = rates.length > 0
            ? rates.reduce((sum, val) => sum + val, 0) / rates.length
            : 0;

        conformityRates.push({
            fileName: fileName,
            conformityRate: conformityRate,
            xRate: xRate,
            yRate: yRate,
            zRate: zRate,
            sRate: sRate,
            count: rates.length,
            features: features
        });
    });

    // 適合率でソート（高い順）
    conformityRates.sort((a, b) => b.conformityRate - a.conformityRate);

    return conformityRates;
}

/**
 * 適合率を表示
 */
function displayConformityRates(conformityRates) {
    const container = document.getElementById('conformityRatesContainer');
    if (!container) return;

    // 適合率の色を判定する関数
    const getRateColor = (rate) => {
        if (rate === null) return '#999';
        return rate >= 80 ? '#4CAF50' : rate >= 60 ? '#FF9800' : '#f44336';
    };

    const formatRate = (rate) => {
        return rate !== null ? rate.toFixed(2) + '%' : '-';
    };

    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 14px;">';
    html += '<thead><tr style="background: #4CAF50; color: white;">';
    html += '<th style="padding: 10px; text-align: left; border: 1px solid #ddd;">ファイル名</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">適合率(計)</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd; background: #45a049;">X軸</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd; background: #45a049;">Y軸</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd; background: #45a049;">Z軸</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd; background: #45a049;">S軸</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">最大負荷</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">平均負荷</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">変動係数</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">ピーク位置</th>';
    html += '</tr></thead><tbody>';

    conformityRates.forEach((rate, index) => {
        const bgColor = index % 2 === 0 ? '#f9f9f9' : 'white';
        const totalRateColor = getRateColor(rate.conformityRate);
        const xRateColor = getRateColor(rate.xRate);
        const yRateColor = getRateColor(rate.yRate);
        const zRateColor = getRateColor(rate.zRate);
        const sRateColor = getRateColor(rate.sRate);

        const features = rate.features.zTcmd;
        const maxLoad = features ? features.max.toFixed(2) : '-';
        const avgLoad = features ? features.avg.toFixed(2) : '-';
        const cv = features ? features.cv.toFixed(2) + '%' : '-';
        const peakPos = features ? 'X=' + features.peakIndex : '-';

        html += `<tr style="background: ${bgColor};">`;
        html += `<td style="padding: 8px; border: 1px solid #ddd;">${rate.fileName}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: ${totalRateColor};">${formatRate(rate.conformityRate)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: ${xRateColor}; font-weight: 600;">${formatRate(rate.xRate)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: ${yRateColor}; font-weight: 600;">${formatRate(rate.yRate)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: ${zRateColor}; font-weight: 600;">${formatRate(rate.zRate)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: ${sRateColor}; font-weight: 600;">${formatRate(rate.sRate)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${maxLoad}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${avgLoad}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${cv}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${peakPos}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

/**
 * 位置-負荷相関分析を実行・表示
 */
function analyzePositionLoadCorrelation(parsedData, fileDataToOriginalName) {
    const container = document.getElementById('positionLoadCorrelationContainer');
    if (!container) return;

    // 各ファイルについて分析
    const analysisResults = [];

    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        // 必要なデータを取得
        const datasets = getDatasets(fileData, ['X-POSF', 'Y-POSF', 'X-TCMD', 'Y-TCMD', 'Z-TCMD']);
        const { 'X-POSF': xPosfDataset, 'Y-POSF': yPosfDataset, 'X-TCMD': xTcmdDataset,
                'Y-TCMD': yTcmdDataset, 'Z-TCMD': zTcmdDataset } = datasets;

        if (!xPosfDataset || !yPosfDataset) return;

        // 平均位置を計算（簡易的に全データの平均）
        const xPosfValues = xPosfDataset.data.map(d => d.y);
        const yPosfValues = yPosfDataset.data.map(d => d.y);
        const avgXPosf = xPosfValues.reduce((sum, v) => sum + v, 0) / xPosfValues.length;
        const avgYPosf = yPosfValues.reduce((sum, v) => sum + v, 0) / yPosfValues.length;

        // 位置誤差（平均からの距離）を計算
        const positionErrors = [];
        const loads = [];

        for (let i = 0; i < xPosfValues.length; i++) {
            const dx = xPosfValues[i] - avgXPosf;
            const dy = yPosfValues[i] - avgYPosf;
            const distance = Math.sqrt(dx * dx + dy * dy);
            positionErrors.push(distance);

            // 合成負荷を計算（XYZの二乗和の平方根）
            const xTcmd = xTcmdDataset ? (xTcmdDataset.data[i]?.y || 0) : 0;
            const yTcmd = yTcmdDataset ? (yTcmdDataset.data[i]?.y || 0) : 0;
            const zTcmd = zTcmdDataset ? (zTcmdDataset.data[i]?.y || 0) : 0;
            const totalLoad = calculateCompositeLoad(xTcmd, yTcmd, zTcmd);
            loads.push(totalLoad);
        }

        // 相関係数を計算
        const correlation = calculateCorrelation(positionErrors, loads);

        // 平均値を計算
        const avgPositionError = positionErrors.reduce((sum, v) => sum + v, 0) / positionErrors.length;
        const avgLoad = loads.reduce((sum, v) => sum + v, 0) / loads.length;

        analysisResults.push({
            fileName: originalFileName,
            correlation: correlation,
            avgPositionError: avgPositionError,
            avgLoad: avgLoad,
            maxPositionError: Math.max(...positionErrors),
            maxLoad: Math.max(...loads)
        });
    });

    // 結果をテーブルで表示
    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 14px;">';
    html += '<thead><tr style="background: #4CAF50; color: white;">';
    html += '<th style="padding: 10px; text-align: left; border: 1px solid #ddd;">ファイル名</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">相関係数</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">平均位置誤差</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">最大位置誤差</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">平均負荷</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">最大負荷</th>';
    html += '</tr></thead><tbody>';

    analysisResults.forEach((result, index) => {
        const bgColor = index % 2 === 0 ? '#f9f9f9' : 'white';
        const corrColor = Math.abs(result.correlation) > 0.7 ? '#F44336' :
                          Math.abs(result.correlation) > 0.4 ? '#FF9800' : '#4CAF50';

        html += `<tr style="background: ${bgColor};">`;
        html += `<td style="padding: 8px; border: 1px solid #ddd;">${result.fileName}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: ${corrColor};">${result.correlation.toFixed(4)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${result.avgPositionError.toFixed(4)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${result.maxPositionError.toFixed(4)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${result.avgLoad.toFixed(2)}</td>`;
        html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${result.maxLoad.toFixed(2)}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';

    container.innerHTML = html;
}

/**
 * 位置別負荷ヒートマップを描画
 */
function drawPositionLoadHeatmap(parsedData, fileDataToOriginalName) {
    const container = document.getElementById('positionLoadHeatmapContainer');
    if (!container) return;

    const gridSize = 20;
    const allGridData = [];
    let globalMaxLoad = 0;

    // 第1パス: 全ファイルのグリッドデータを計算し、最大負荷を取得
    parsedData.forEach((fileData) => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        // 必要なデータを取得
        const datasets = getDatasets(fileData, ['X-POSF', 'Y-POSF', 'X-TCMD', 'Y-TCMD', 'Z-TCMD']);
        const { 'X-POSF': xPosfDataset, 'Y-POSF': yPosfDataset, 'X-TCMD': xTcmdDataset,
                'Y-TCMD': yTcmdDataset, 'Z-TCMD': zTcmdDataset } = datasets;

        if (!xPosfDataset || !yPosfDataset || !zTcmdDataset) return;

        // データを収集
        const dataPoints = [];
        for (let i = 0; i < xPosfDataset.data.length; i++) {
            const xPos = xPosfDataset.data[i].y;
            const yPos = yPosfDataset.data[i].y;
            const xTcmd = xTcmdDataset ? (xTcmdDataset.data[i]?.y || 0) : 0;
            const yTcmd = yTcmdDataset ? (yTcmdDataset.data[i]?.y || 0) : 0;
            const zTcmd = zTcmdDataset.data[i].y;
            const totalLoad = calculateCompositeLoad(xTcmd, yTcmd, zTcmd);

            dataPoints.push({ x: xPos, y: yPos, load: totalLoad });
        }

        // X-Y空間をグリッド分割
        const xMin = Math.min(...dataPoints.map(p => p.x));
        const xMax = Math.max(...dataPoints.map(p => p.x));
        const yMin = Math.min(...dataPoints.map(p => p.y));
        const yMax = Math.max(...dataPoints.map(p => p.y));

        const xStep = (xMax - xMin) / gridSize;
        const yStep = (yMax - yMin) / gridSize;

        // グリッドごとの平均負荷を計算
        const grid = [];
        for (let i = 0; i < gridSize; i++) {
            grid[i] = [];
            for (let j = 0; j < gridSize; j++) {
                const xStart = xMin + i * xStep;
                const xEnd = xStart + xStep;
                const yStart = yMin + j * yStep;
                const yEnd = yStart + yStep;

                const pointsInCell = dataPoints.filter(p =>
                    p.x >= xStart && p.x < xEnd && p.y >= yStart && p.y < yEnd
                );

                if (pointsInCell.length > 0) {
                    const avgLoad = pointsInCell.reduce((sum, p) => sum + p.load, 0) / pointsInCell.length;
                    grid[i][j] = avgLoad;
                    globalMaxLoad = Math.max(globalMaxLoad, avgLoad);
                } else {
                    grid[i][j] = null;
                }
            }
        }

        allGridData.push({ fileName: originalFileName, grid: grid });
    });

    // 第2パス: 統一されたカラースケールでヒートマップを描画
    let html = '<div style="display: flex; gap: 20px; margin-bottom: 20px;">';
    html += '<div style="flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">';

    allGridData.forEach((fileGridData) => {
        const { fileName, grid } = fileGridData;

        // ヒートマップをHTMLテーブルで描画（正方形セルにするため固定サイズ）
        const cellSize = 15; // 20×20グリッドなので各セルは正方形
        html += `<div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">`;
        html += `<h4 style="font-size: 13px; margin-bottom: 10px; color: #333; text-align: center;">${fileName}</h4>`;
        html += `<div style="display: flex; gap: 10px; align-items: flex-start; justify-content: center;">`;

        // ヒートマップグリッド
        html += `<div style="position: relative;">`;
        html += `<table style="border-collapse: collapse; border: 2px solid #333; table-layout: fixed;">`;

        // Y軸は上から下へ（逆順）
        for (let j = gridSize - 1; j >= 0; j--) {
            html += '<tr>';
            for (let i = 0; i < gridSize; i++) {
                const load = grid[i][j];
                let color = '#f0f0f0'; // デフォルト（データなし）

                if (load !== null) {
                    const ratio = load / globalMaxLoad; // グローバル最大値を使用
                    color = getHeatmapColor(ratio);
                }

                html += `<td style="width: ${cellSize}px; height: ${cellSize}px; background: ${color}; border: 1px solid #ddd; padding: 0;" title="Load: ${load ? load.toFixed(2) : 'N/A'}"></td>`;
            }
            html += '</tr>';
        }
        html += '</table>';

        // 軸ラベル
        html += `<div style="text-align: center; margin-top: 5px; font-size: 10px; color: #666;">X-POSF →</div>`;
        html += `<div style="position: absolute; left: -35px; top: 50%; transform: translateY(-50%) rotate(-90deg); font-size: 10px; color: #666; white-space: nowrap;">Y-POSF →</div>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
    });

    html += '</div>'; // グリッドレイアウトを閉じる

    // 統一されたカラーバー（右側に表示）
    html += `<div style="display: flex; flex-direction: column; justify-content: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">`;
    html += `<div style="font-size: 14px; font-weight: bold; margin-bottom: 10px; text-align: center;">負荷スケール</div>`;
    html += `<div style="display: flex; flex-direction: column;">`;

    const colorSteps = 10;
    for (let k = colorSteps - 1; k >= 0; k--) {
        const ratio = k / (colorSteps - 1);
        const load = globalMaxLoad * ratio;
        const color = getHeatmapColor(ratio);

        html += `<div style="display: flex; align-items: center; margin-bottom: 4px;">`;
        html += `<div style="width: 40px; height: 20px; background: ${color}; border: 1px solid #999;"></div>`;
        html += `<span style="margin-left: 10px; font-size: 12px; min-width: 50px;">${load.toFixed(1)}</span>`;
        html += `</div>`;
    }

    html += `</div>`;
    html += `<div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ddd; font-size: 11px; color: #666; text-align: center;">`;
    html += `</div>`;
    html += `</div>`;
    html += '</div>'; // 全体のflexコンテナを閉じる

    container.innerHTML = html;
}

/**
 * セグメント別分析を実行・表示
 */
function analyzeSegments(parsedData, fileDataToOriginalName) {
    const container = document.getElementById('segmentAnalysisContainer');
    if (!container) return;

    const segmentResults = [];

    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        // 必要なデータを取得
        const datasets = getDatasets(fileData, ['X-TCMD', 'Y-TCMD', 'Z-TCMD']);
        const { 'X-TCMD': xTcmdDataset, 'Y-TCMD': yTcmdDataset, 'Z-TCMD': zTcmdDataset } = datasets;

        if (!zTcmdDataset) return;

        // オフセット値を取得
        const fileOffset = fileOffsets.get(originalFileName) || 0;

        // オフセットを適用したデータ範囲を計算
        const startIndex = Math.max(0, fileOffset);
        const endIndex = zTcmdDataset.data.length;
        const effectiveLength = endIndex - startIndex;

        if (effectiveLength <= 0) return;

        // 3つのセグメントに分割（オフセット適用後）
        const segment1End = startIndex + Math.floor(effectiveLength * 0.33);
        const segment2End = startIndex + Math.floor(effectiveLength * 0.67);

        const segments = [
            { name: '開始', range: '0-33%', startIdx: startIndex, endIdx: segment1End },
            { name: '中盤', range: '33-67%', startIdx: segment1End, endIdx: segment2End },
            { name: '終盤', range: '67-100%', startIdx: segment2End, endIdx: endIndex }
        ];

        const segmentStats = segments.map(segment => {
            // 1パスで統計量を計算（パフォーマンス最適化）
            let sum = 0;
            let maxLoad = -Infinity;
            let minLoad = Infinity;
            let count = 0;
            const loads = [];

            for (let i = segment.startIdx; i < segment.endIdx && i < zTcmdDataset.data.length; i++) {
                const zTcmd = zTcmdDataset.data[i].y;
                const xTcmd = xTcmdDataset && i < xTcmdDataset.data.length ? xTcmdDataset.data[i].y : 0;
                const yTcmd = yTcmdDataset && i < yTcmdDataset.data.length ? yTcmdDataset.data[i].y : 0;
                const totalLoad = calculateCompositeLoad(xTcmd, yTcmd, zTcmd);

                loads.push(totalLoad);
                sum += totalLoad;
                maxLoad = Math.max(maxLoad, totalLoad);
                minLoad = Math.min(minLoad, totalLoad);
                count++;
            }

            if (count === 0) {
                return {
                    name: segment.name,
                    range: segment.range,
                    avgLoad: 0,
                    maxLoad: 0,
                    minLoad: 0,
                    stdDev: 0,
                    variationCoeff: 0
                };
            }

            const avgLoad = sum / count;
            const stdDev = Math.sqrt(loads.reduce((sum, v) => sum + Math.pow(v - avgLoad, 2), 0) / count);

            return {
                name: segment.name,
                range: segment.range,
                avgLoad: avgLoad,
                maxLoad: maxLoad,
                minLoad: minLoad,
                stdDev: stdDev,
                variationCoeff: (stdDev / Math.abs(avgLoad)) * 100
            };
        });

        segmentResults.push({
            fileName: originalFileName,
            segments: segmentStats
        });
    });

    // テーブルで結果を表示
    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">';
    html += '<thead><tr style="background: #4CAF50; color: white;">';
    html += '<th style="padding: 10px; text-align: left; border: 1px solid #ddd;">ファイル名</th>';
    html += '<th style="padding: 10px; text-align: center; border: 1px solid #ddd;">セグメント</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">平均負荷</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">最大負荷</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">最小負荷</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">標準偏差</th>';
    html += '<th style="padding: 10px; text-align: right; border: 1px solid #ddd;">変動係数(%)</th>';
    html += '</tr></thead><tbody>';

    segmentResults.forEach((result, fileIndex) => {
        result.segments.forEach((segment, segIndex) => {
            const bgColor = fileIndex % 2 === 0 ? '#f9f9f9' : 'white';
            const isFirst = segIndex === 0;

            // 変動係数で色分け
            let variationColor = '#4CAF50'; // 緑（安定）
            if (segment.variationCoeff > 50) {
                variationColor = '#F44336'; // 赤（不安定）
            } else if (segment.variationCoeff > 30) {
                variationColor = '#FF9800'; // オレンジ（中程度）
            }

            html += `<tr style="background: ${bgColor};">`;
            if (isFirst) {
                html += `<td rowspan="3" style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${result.fileName}</td>`;
            }
            html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: center;"><strong>${segment.name}</strong><br><span style="font-size: 11px; color: #666;">(${segment.range})</span></td>`;
            html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${segment.avgLoad.toFixed(2)}</td>`;
            html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${segment.maxLoad.toFixed(2)}</td>`;
            html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${segment.minLoad.toFixed(2)}</td>`;
            html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${segment.stdDev.toFixed(2)}</td>`;
            html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: ${variationColor};">${segment.variationCoeff.toFixed(1)}%</td>`;
            html += '</tr>';
        });
    });

    html += '</tbody></table>';

    container.innerHTML = html;
}

/**
 * 統計データを計算
 */
function calculateStatistics(parsedData, fileDataToOriginalName) {
    // 統計に含める列名を指定
    const targetColumns = ['X-TCMD', 'Y-TCMD', 'Z-TCMD', 'S-TCMD'];

    // フィールド名（列名）ごとに、ファイル別の統計をグループ化
    const fieldStats = new Map(); // Map<columnName, Map<fileName, {deviation, average, max}>>

    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        // オフセット値を取得
        const fileOffset = fileOffsets.get(originalFileName) || 0;

        fileData.datasets.forEach(dataset => {
            const columnName = dataset.label.split(' - ')[1] || '';
            // 指定された列のみを統計に含める
            if (!targetColumns.includes(columnName)) return;
            if (xAxisPattern && columnName === xAxisPattern) return;
            if (excludedColumns.includes(columnName)) return;

            // 解析範囲が指定されている場合はその範囲のみを使用
            let filteredData = dataset.data;
            if (analysisStartValue !== null && analysisEndValue !== null) {
                filteredData = dataset.data.filter((point, index) => {
                    const adjustedIndex = index + fileOffset;
                    return adjustedIndex >= analysisStartValue && adjustedIndex <= analysisEndValue;
                });
            }

            // フィルタ後のデータが空の場合はスキップ
            if (filteredData.length === 0) return;

            // 100個の移動平均を計算
            const movingAvg = applyMovingAverage(
                filteredData.map(point => ({ x: point.x, y: point.y })),
                100
            );

            // 移動平均からの差分を計算
            const deviations = [];
            const absDeviations = [];
            filteredData.forEach((point, index) => {
                if (index < movingAvg.length) {
                    const diff = point.y - movingAvg[index].y;
                    deviations.push(diff);
                    absDeviations.push(Math.abs(diff));
                }
            });

            // 移動平均からの絶対値積算を計算
            const deviationSum = absDeviations.reduce((a, b) => a + b, 0);

            // 移動平均からの差分の平均値を計算
            const average = deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0;

            // 移動平均からの差分で絶対値が最大のものを取得（符号を保持）
            let max = 0;
            if (deviations.length > 0) {
                let maxAbsIndex = 0;
                let maxAbsValue = 0;
                absDeviations.forEach((absVal, idx) => {
                    if (absVal > maxAbsValue) {
                        maxAbsValue = absVal;
                        maxAbsIndex = idx;
                    }
                });
                max = deviations[maxAbsIndex]; // 元の符号を保持した値
            }

            // フィールドごとにデータを格納
            if (!fieldStats.has(columnName)) {
                fieldStats.set(columnName, new Map());
            }
            fieldStats.get(columnName).set(originalFileName, {
                deviation: deviationSum,
                average: average,
                max: max
            });
        });
    });

    // フィールド名（列名）をX軸ラベルとして取得（指定された順序で）
    const columnNames = targetColumns.filter(col => fieldStats.has(col));

    // ファイル名のリストを取得（すべてのフィールドから）
    const fileNames = new Set();
    fieldStats.forEach(fileMap => {
        fileMap.forEach((_, fileName) => {
            fileNames.add(fileName);
        });
    });
    const fileNameList = Array.from(fileNames).sort();

    // 各ファイル用のデータセットを作成
    const deviationDatasets = [];
    const averageDatasets = [];
    const maxDatasets = [];

    fileNameList.forEach((fileName, fileIndex) => {
        const deviationData = [];
        const averageData = [];
        const maxData = [];

        columnNames.forEach(columnName => {
            const fileMap = fieldStats.get(columnName);
            const stats = fileMap.get(fileName);

            if (stats) {
                deviationData.push(stats.deviation);
                averageData.push(stats.average);
                maxData.push(stats.max);
            } else {
                deviationData.push(null);
                averageData.push(null);
                maxData.push(null);
            }
        });

        // ファイルごとに異なる色を割り当て
        const colorFamily = COLOR_FAMILIES[fileIndex % COLOR_FAMILIES.length];
        const color = colorFamily[0];

        deviationDatasets.push({
            label: fileName,
            data: deviationData,
            backgroundColor: rgbToRgba(color, 0.6),
            borderColor: color,
            borderWidth: 2
        });

        averageDatasets.push({
            label: fileName,
            data: averageData,
            backgroundColor: rgbToRgba(color, 0.6),
            borderColor: color,
            borderWidth: 2
        });

        maxDatasets.push({
            label: fileName,
            data: maxData,
            backgroundColor: rgbToRgba(color, 0.6),
            borderColor: color,
            borderWidth: 2
        });
    });

    return {
        deviation: { labels: columnNames, datasets: deviationDatasets },
        average: { labels: columnNames, datasets: averageDatasets },
        max: { labels: columnNames, datasets: maxDatasets }
    };
}

/**
 * 棒グラフを作成（グループ化された棒グラフ）
 */
function createBarChart(canvasId, statsData, existingChart) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // 既存のチャートがあれば破棄
    if (existingChart) {
        existingChart.destroy();
    }

    const newChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: statsData.labels,
            datasets: statsData.datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    enabled: tooltipEnabled,
                    mode: tooltipSingleMode ? 'nearest' : 'index',
                    intersect: false,
                    axis: tooltipSingleMode ? 'xy' : 'x'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }
        }
    });

    // グローバル変数に保存
    if (canvasId === 'deviationChart') deviationChart = newChart;
    if (canvasId === 'averageChart') averageChart = newChart;
    if (canvasId === 'maxChart') maxChart = newChart;
}

/**
 * X-TCMD vs Y-TCMD 散布図を作成
 */
async function createScatterPlot() {
    const ctx = document.getElementById('scatterChart');
    if (!ctx) return;

    const scatterCard = document.getElementById('scatterCard');

    // データ範囲が設定されていない場合は非表示
    if (noLoadStartValue === null || noLoadEndValue === null ||
        analysisStartValue === null || analysisEndValue === null) {
        // 散布図を非表示にし、メイングラフを全幅に
        scatterCard.style.flex = '0 0 0';
        scatterCard.style.display = 'none';

        const mainChartWrapper = document.getElementById('mainChartWrapper');
        if (mainChartWrapper) {
            mainChartWrapper.style.flex = '1';
        }

        // メイングラフのリサイズをトリガー
        if (chart) {
            setTimeout(() => {
                chart.resize();
            }, 300);
        }
        return;
    }

    // 既存のチャートがあれば破棄
    if (scatterChart) {
        scatterChart.destroy();
    }

    // 各ファイルからX-TCMDとY-TCMDのデータを取得
    const datasets = [];

    // 無負荷データは青系統で統一
    const noLoadColor = { bg: 'rgba(59, 130, 246, 0.6)', border: 'rgb(37, 99, 235)' };

    // 解析データはファイルごとに異なる色を割り当て（青系は除外）
    const analysisColors = [
        { bg: 'rgba(220, 38, 38, 0.6)', border: 'rgb(185, 28, 28)' },      // 赤系
        { bg: 'rgba(234, 88, 12, 0.6)', border: 'rgb(194, 65, 12)' },      // オレンジ系
        { bg: 'rgba(234, 179, 8, 0.6)', border: 'rgb(202, 138, 4)' },      // 黄色系
        { bg: 'rgba(22, 163, 74, 0.6)', border: 'rgb(21, 128, 61)' },      // 緑系
        { bg: 'rgba(8, 145, 178, 0.6)', border: 'rgb(14, 116, 144)' },     // シアン系
        { bg: 'rgba(147, 51, 234, 0.6)', border: 'rgb(126, 34, 206)' },    // 紫系
        { bg: 'rgba(219, 39, 119, 0.6)', border: 'rgb(190, 24, 93)' },     // ピンク系
        { bg: 'rgba(139, 92, 46, 0.6)', border: 'rgb(102, 65, 28)' },      // 茶色系
        { bg: 'rgba(100, 116, 139, 0.6)', border: 'rgb(71, 85, 105)' },    // グレー系
        { bg: 'rgba(236, 72, 153, 0.6)', border: 'rgb(219, 39, 119)' }     // マゼンタ系
    ];

    for (let fileIndex = 0; fileIndex < uploadedFiles.length; fileIndex++) {
        const file = uploadedFiles[fileIndex];
        try {
            const fileName = file.name;
            const fileNameLower = fileName.toLowerCase();
            const offset = fileOffsets.get(fileName) || 0;

            // 解析データ用の色を割り当て
            const colorIndex = fileIndex % analysisColors.length;
            const analysisColor = analysisColors[colorIndex];

            let headers = [];
            let data = [];

            // ファイル形式に応じて解析
            if (fileNameLower.endsWith('.xlsx') || fileNameLower.endsWith('.xls')) {
                const arrayBuffer = await file.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                if (jsonData.length > 0) {
                    headers = jsonData[0];
                    data = jsonData.slice(1);
                }
            } else {
                // CSV
                const text = await file.text();
                const lines = text.trim().split('\n');
                if (lines.length > 0) {
                    headers = lines[0].split(',').map(h => h.trim());
                    data = lines.slice(1).map(line => line.split(',').map(v => v.trim()));
                }
            }

            // X-TCMDとY-TCMDの列を探す
            const xColumnIndex = headers.findIndex(h => h === 'X-TCMD');
            const yColumnIndex = headers.findIndex(h => h === 'Y-TCMD');

            if (xColumnIndex === -1 || yColumnIndex === -1) continue;

            // 無負荷時データと解析データを分離
            const noLoadData = [];
            const analysisData = [];

            data.forEach((row, rowIndex) => {
                const adjustedIndex = rowIndex + offset;
                const xValue = parseFloat(row[xColumnIndex]);
                const yValue = parseFloat(row[yColumnIndex]);

                if (isNaN(xValue) || isNaN(yValue)) return;

                const dataPoint = { x: xValue, y: yValue };

                // 無負荷時データ範囲
                if (adjustedIndex >= noLoadStartValue && adjustedIndex <= noLoadEndValue) {
                    noLoadData.push(dataPoint);
                }
                // 解析データ範囲
                else if (adjustedIndex >= analysisStartValue && adjustedIndex <= analysisEndValue) {
                    analysisData.push(dataPoint);
                }
            });

            // 無負荷時データのデータセット（青系統で統一）
            if (noLoadData.length > 0) {
                datasets.push({
                    label: `${fileName} (無負荷)`,
                    data: noLoadData,
                    backgroundColor: noLoadColor.bg,
                    borderColor: noLoadColor.border,
                    borderWidth: 1,
                    pointRadius: 3,
                    pointHoverRadius: 5
                });
            }

            // 解析データのデータセット（ファイルごとに異なる色）
            if (analysisData.length > 0) {
                datasets.push({
                    label: `${fileName} (解析)`,
                    data: analysisData,
                    backgroundColor: analysisColor.bg,
                    borderColor: analysisColor.border,
                    borderWidth: 1,
                    pointRadius: 3,
                    pointHoverRadius: 5
                });
            }
        } catch (error) {
            console.error(`Error processing ${file.name} for scatter plot:`, error);
        }
    }

    // 散布図を作成
    scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,  // 常に表示
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 12,
                        font: { size: 12 }
                    },
                    onClick: function(_e, legendItem, legend) {
                        const index = legendItem.datasetIndex;
                        const ci = legend.chart;

                        if (ci.isDatasetVisible(index)) {
                            ci.hide(index);
                            legendItem.hidden = true;
                        } else {
                            ci.show(index);
                            legendItem.hidden = false;
                        }
                    }
                },
                tooltip: {
                    enabled: tooltipEnabled,
                    mode: tooltipSingleMode ? 'nearest' : 'index',
                    intersect: false,
                    axis: tooltipSingleMode ? 'xy' : 'x',
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: (${context.parsed.x.toFixed(2)}, ${context.parsed.y.toFixed(2)})`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'X-TCMD',
                        font: { size: 14, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Y-TCMD',
                        font: { size: 14, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                }
            }
        }
    });

    // 散布図カードを表示（50%ずつの幅に設定）
    const mainChartWrapper = document.getElementById('mainChartWrapper');

    // レイアウトを先に変更
    if (mainChartWrapper) {
        mainChartWrapper.style.flex = '1'; // 50%
    }
    scatterCard.style.flex = '1'; // 50%
    scatterCard.style.display = 'block';

    // レイアウト変更後、少し待ってからリサイズ
    return new Promise(resolve => {
        setTimeout(() => {
            if (chart) {
                chart.resize();
            }
            if (scatterChart) {
                scatterChart.resize();
            }
            resolve();
        }, 350);
    });
}

/**
 * 初期化
 */
function init() {
    // ページ読み込み時にファイル入力をクリア
    if (elements.csvInput) {
        elements.csvInput.value = '';
    }

    // ファイル入力
    elements.csvInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        uploadedFiles = files;
        fileOffsets.clear();

        // 各ファイルのSPEED上昇位置を検出し、オフセットを自動設定
        const riseRows = [];
        for (const file of files) {
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.csv')) {
                const text = await file.text();
                const riseRow = detectSpeedRiseRow(text);
                riseRows.push(riseRow);
            } else {
                riseRows.push(0);
            }
        }

        // 最小の上昇位置を基準にオフセットを計算
        const minRiseRow = Math.min(...riseRows);
        files.forEach((file, index) => {
            const offset = minRiseRow - riseRows[index];
            fileOffsets.set(file.name, offset);
        });

        displayFileList(files);

        preserveZoom = false;
        savedZoomState = null;
        datasetVisibility.clear();

        await renderChartFromFiles();
    });

    // ズームリセット
    elements.resetZoomBtn.addEventListener('click', () => {
        if (chart) {
            chart.resetZoom();
            savedZoomState = null;
            preserveZoom = false;
        }
        if (derivativeChart) {
            derivativeChart.resetZoom();
        }
    });

    // CSV出力
    elements.exportCsvBtn.addEventListener('click', () => {
        if (chart) exportChartDataToCsv();
    });

    // 凡例チェックボックス
    elements.legendCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            tooltipEnabled = true;
            tooltipSingleMode = false;
            elements.tooltipSingleCheckbox.checked = false;
        } else {
            tooltipEnabled = false;
        }
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
        // 統計グラフと散布図とトルク変動率グラフも更新
        updateStatisticsChartsOptions();
        updateScatterChartOptions();
        updateDerivativeChartOptions();
    });

    // 凡例(単体)チェックボックス
    elements.tooltipSingleCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            tooltipEnabled = true;
            tooltipSingleMode = true;
            elements.legendCheckbox.checked = false;
        } else {
            tooltipEnabled = false;
            tooltipSingleMode = false;
        }
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
        // 統計グラフと散布図とトルク変動率グラフも更新
        updateStatisticsChartsOptions();
        updateScatterChartOptions();
        updateDerivativeChartOptions();
    });

    // 移動平均列選択
    elements.smoothColumnSelect.addEventListener('change', async (e) => {
        smoothColumnName = e.target.value;
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // 移動平均ウィンドウサイズ変更
    elements.smoothWindowInput.addEventListener('input', async (e) => {
        const value = parseInt(e.target.value);
        if (!isNaN(value) && value >= 1) {
            smoothWindow = value;
            if (chart && smoothColumnName) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        }
    });

    // X軸選択
    elements.xAxisSelect.addEventListener('change', async (e) => {
        xAxisPattern = e.target.value;
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // グラフ種類選択
    elements.chartTypeSelect.addEventListener('change', async (e) => {
        chartType = e.target.value;
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // 閾値入力
    [
        { input: elements.upperThresholdInput, setValue: (val) => upperThresholdValue = val },
        { input: elements.lowerThresholdInput, setValue: (val) => lowerThresholdValue = val }
    ].forEach(({ input, setValue }) => {
        input.addEventListener('input', async (e) => {
            const value = e.target.value;
            setValue(value === '' ? null : parseFloat(value));
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });
    });

    // Y軸設定
    elements.yAxisElements.forEach((elems, index) => {
        elems.select.addEventListener('change', async (e) => {
            yAxisConfigs[index].axis = e.target.value;
            if (chart && yAxisConfigs[index].pattern) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.check.addEventListener('change', async (e) => {
            yAxisConfigs[index].enabled = e.target.checked;
            if (e.target.checked) {
                elems.input.style.display = '';
                elems.columnSelect.style.display = 'none';
            } else {
                elems.input.style.display = 'none';
                elems.columnSelect.style.display = '';
                yAxisConfigs[index].pattern = elems.columnSelect.value;
            }
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.input.addEventListener('input', async (e) => {
            yAxisConfigs[index].pattern = e.target.value.trim();
            if (chart && elems.check.checked) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.columnSelect.addEventListener('change', async (e) => {
            yAxisConfigs[index].pattern = e.target.value;
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.typeSelect.addEventListener('change', async (e) => {
            yAxisConfigs[index].chartType = e.target.value;
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });
    });

    // キーボード操作
    document.addEventListener('keydown', (e) => {
        // アクティブなグラフがない場合は何もしない
        if (!activeChart) return;

        // input、textarea、select要素にフォーカスがある場合は何もしない
        const activeElement = document.activeElement;
        if (activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.tagName === 'SELECT'
        )) {
            return;
        }

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' ||
            e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();

            if (!keysPressed[e.key]) {
                keysPressed[e.key] = true;
                if (!animationFrameId) {
                    continuousPan();
                }
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' ||
            e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            keysPressed[e.key] = false;

            if (!keysPressed.ArrowRight && !keysPressed.ArrowLeft &&
                !keysPressed.ArrowUp && !keysPressed.ArrowDown) {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            }
        }
    });

    // スクロールバー操作
    elements.xScrollbar.addEventListener('input', (e) => {
        if (!chart) return;
        panFromScrollbar('x', parseFloat(e.target.value));
    });

    elements.yScrollbar.addEventListener('input', (e) => {
        if (!chart) return;
        panFromScrollbar('y', parseFloat(e.target.value));
    });

    // メイングラフエリアのイベント
    const chartCanvas = document.getElementById('myChart');
    if (chartCanvas) {
        // クリックでアクティブ化
        chartCanvas.addEventListener('click', () => {
            activeChart = 'main';
        });

        // 右クリックイベント
        chartCanvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showDataRangeModal();
        });
    }

    // トルク変動率グラフエリアのイベント
    const derivativeCanvas = document.getElementById('derivativeChart');
    if (derivativeCanvas) {
        // クリックでアクティブ化
        derivativeCanvas.addEventListener('click', () => {
            activeChart = 'derivative';
        });
    }

    // モーダルのイベントリスナー
    const dataRangeModal = document.getElementById('dataRangeModal');
    const cancelBtn = document.getElementById('cancelDataRange');
    const applyBtn = document.getElementById('applyDataRange');

    // キャンセルボタン
    cancelBtn.addEventListener('click', () => {
        dataRangeModal.style.display = 'none';
    });

    // モーダル背景クリックで閉じる
    dataRangeModal.addEventListener('click', (e) => {
        if (e.target === dataRangeModal) {
            dataRangeModal.style.display = 'none';
        }
    });

    // 適用処理の共通関数
    const applyDataRange = async () => {
        noLoadStartValue = parseInt(document.getElementById('noLoadStart').value) || null;
        noLoadEndValue = parseInt(document.getElementById('noLoadEnd').value) || null;
        analysisStartValue = parseInt(document.getElementById('analysisStart').value) || null;
        analysisEndValue = parseInt(document.getElementById('analysisEnd').value) || null;

        dataRangeModal.style.display = 'none';

        // 散布図を作成（レイアウト調整のため先に実行）
        await createScatterPlot();

        // グラフを再描画してハッチングを追加
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    };

    // 適用ボタン
    applyBtn.addEventListener('click', applyDataRange);

    // モーダル内の入力フィールドでEnterキーを押したときに適用
    const modalInputs = [
        document.getElementById('noLoadStart'),
        document.getElementById('noLoadEnd'),
        document.getElementById('analysisStart'),
        document.getElementById('analysisEnd')
    ];

    modalInputs.forEach(input => {
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyDataRange();
                }
            });
        }
    });

    // データ範囲エッジのドラッグ機能をセットアップ
    setupRangeEdgeDragging();

    // 散布図の閉じるボタン
    const closeScatterBtn = document.getElementById('closeScatterBtn');
    if (closeScatterBtn) {
        closeScatterBtn.addEventListener('click', async () => {
            // データ範囲設定をクリア
            noLoadStartValue = null;
            noLoadEndValue = null;
            analysisStartValue = null;
            analysisEndValue = null;

            // モーダルの入力フィールドもクリア
            updateModalInputs();

            // 散布図を非表示にし、メイングラフを全幅に
            const scatterCard = document.getElementById('scatterCard');
            const mainChartWrapper = document.getElementById('mainChartWrapper');

            if (scatterCard) {
                scatterCard.style.flex = '0 0 0';
                scatterCard.style.display = 'none';
            }

            if (mainChartWrapper) {
                mainChartWrapper.style.flex = '1';
            }

            // 散布図を破棄
            if (scatterChart) {
                scatterChart.destroy();
                scatterChart = null;
            }

            // メイングラフを再描画（ハッチングを削除）
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });
    }
}

/**
 * データ範囲選択モーダルを表示
 */
function showDataRangeModal() {
    const modal = document.getElementById('dataRangeModal');

    // 現在の値を入力フィールドに設定
    updateModalInputs();

    modal.style.display = 'flex';

    // モーダル内の最初の入力フィールドにフォーカス
    const firstInput = document.getElementById('noLoadStart');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
    }
}

// ===========================
// 3Dシミュレーション
// ===========================

/**
 * 3Dシミュレーションを初期化
 */
function init3DSimulation(parsedData, fileDataToOriginalName) {
    const container = document.getElementById('simulation3dContainer');
    if (!container) return;

    // データが空の場合は何もしない
    if (!parsedData || parsedData.length === 0) {
        return;
    }

    // Three.jsの読み込みを待つ
    if (!window.THREE || !window.OrbitControls) {
        setTimeout(() => init3DSimulation(parsedData, fileDataToOriginalName), 100);
        return;
    }

    // 既存のシミュレーションをクリーンアップ
    cleanup3DSimulation();

    // シーンの作成
    simulation3D.scene = new THREE.Scene();
    simulation3D.scene.background = new THREE.Color(0x1a1a1a);

    // カメラの作成
    const width = container.clientWidth;
    const height = container.clientHeight;
    simulation3D.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    simulation3D.camera.position.set(150, 150, 150);
    simulation3D.camera.lookAt(0, 0, 0);

    // レンダラーの作成
    simulation3D.renderer = new THREE.WebGLRenderer({ antialias: true });
    simulation3D.renderer.setSize(width, height);
    simulation3D.renderer.shadowMap.enabled = true;
    simulation3D.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(simulation3D.renderer.domElement);

    // OrbitControlsの追加（グローバルに公開されたOrbitControlsクラスを使用）
    simulation3D.controls = new window.OrbitControls(simulation3D.camera, simulation3D.renderer.domElement);
    simulation3D.controls.enableDamping = true;
    simulation3D.controls.dampingFactor = 0.05;

    // ライトの追加
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    simulation3D.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(20, 30, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    simulation3D.scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-20, 20, -20);
    simulation3D.scene.add(directionalLight2);

    // 座標軸を追加
    addColoredAxes();

    // 複数ファイルの3D軌跡を作成
    create3DTrajectories(parsedData, fileDataToOriginalName);

    // アニメーションループ
    function animate() {
        requestAnimationFrame(animate);
        if (simulation3D.controls) {
            simulation3D.controls.update();
        }
        if (simulation3D.renderer && simulation3D.scene && simulation3D.camera) {
            simulation3D.renderer.render(simulation3D.scene, simulation3D.camera);
        }
    }
    animate();

    // リサイズ対応
    const resizeObserver = new ResizeObserver(() => {
        if (!simulation3D.camera || !simulation3D.renderer) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        simulation3D.camera.aspect = width / height;
        simulation3D.camera.updateProjectionMatrix();
        simulation3D.renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    // コントロールイベントの設定
    setup3DControls();
}

/**
 * 色付き座標軸を追加
 */
function addColoredAxes() {
    const axisLength = 50;
    const arrowLength = 5;
    const arrowWidth = 2;

    // X軸（赤）
    const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(axisLength, 0, 0)
    ]);
    const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
    const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
    simulation3D.scene.add(xAxis);

    // X軸矢印
    const xArrowGeometry = new THREE.ConeGeometry(arrowWidth, arrowLength, 8);
    const xArrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const xArrow = new THREE.Mesh(xArrowGeometry, xArrowMaterial);
    xArrow.position.set(axisLength, 0, 0);
    xArrow.rotation.z = -Math.PI / 2;
    simulation3D.scene.add(xArrow);

    // Y軸（緑）
    const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, axisLength, 0)
    ]);
    const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
    const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
    simulation3D.scene.add(yAxis);

    // Y軸矢印
    const yArrowGeometry = new THREE.ConeGeometry(arrowWidth, arrowLength, 8);
    const yArrowMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const yArrow = new THREE.Mesh(yArrowGeometry, yArrowMaterial);
    yArrow.position.set(0, axisLength, 0);
    simulation3D.scene.add(yArrow);

    // Z軸（青）
    const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, axisLength)
    ]);
    const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 2 });
    const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
    simulation3D.scene.add(zAxis);

    // Z軸矢印
    const zArrowGeometry = new THREE.ConeGeometry(arrowWidth, arrowLength, 8);
    const zArrowMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    const zArrow = new THREE.Mesh(zArrowGeometry, zArrowMaterial);
    zArrow.position.set(0, 0, axisLength);
    zArrow.rotation.x = Math.PI / 2;
    simulation3D.scene.add(zArrow);

    // 軸ラベル
    addAxisLabel('X-TCMD', axisLength + 5, 0, 0, 0xff0000);
    addAxisLabel('Z-TCMD (負荷)', 0, axisLength + 5, 0, 0x00ff00);
    addAxisLabel('Y-TCMD', 0, 0, axisLength + 5, 0x0000ff);
}

/**
 * 軸ラベルを追加
 */
function addAxisLabel(text, x, y, z, color) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    context.fillStyle = '#' + color.toString(16).padStart(6, '0');
    context.font = 'Bold 32px Arial';
    context.textAlign = 'center';
    context.fillText(text, 128, 45);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(8, 2, 1);
    sprite.position.set(x, y, z);
    simulation3D.scene.add(sprite);
}

/**
 * 複数ファイルの3D軌跡を作成
 */
function create3DTrajectories(parsedData, fileDataToOriginalName) {
    simulation3D.animationData = [];

    const fileColors = [
        0x0000ff, // 青
        0x00ff00, // 緑
        0xffff00, // 黄色
        0xffffff, // 白
        0xff00ff, // マゼンタ
        0x00ffff, // シアン
        0xffa500, // オレンジ
        0xff1493  // ディープピンク
    ];

    parsedData.forEach((fileData, fileIndex) => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) {
            return;
        }

        // X-TCMD, Y-TCMD, Z-TCMDのデータを取得
        const xTcmdDataset = fileData.datasets.find(ds => ds.label.includes('X-TCMD'));
        const yTcmdDataset = fileData.datasets.find(ds => ds.label.includes('Y-TCMD'));
        const zTcmdDataset = fileData.datasets.find(ds => ds.label.includes('Z-TCMD'));

        if (!xTcmdDataset || !yTcmdDataset || !zTcmdDataset) {
            return;
        }

        // データを配列に変換（座標値そのものを使用）
        const xData = xTcmdDataset.data.map(point => point.y);
        const yData = yTcmdDataset.data.map(point => point.y);
        const zData = zTcmdDataset.data.map(point => point.y);

        const colorIndex = fileIndex % fileColors.length;
        const color = fileColors[colorIndex];

        // 3D軌跡ラインとマーカーを作成
        const trajectoryGroup = create3DTrajectory(xData, yData, zData, color);
        simulation3D.scene.add(trajectoryGroup);

        // アニメーションデータを保存
        simulation3D.animationData.push({
            name: originalFileName,
            trajectoryGroup: trajectoryGroup,
            xData: xData,
            yData: yData,
            zData: zData,
            color: color
        });
    });

    // 凡例を更新
    update3DLegend();
}

/**
 * 3D凡例を更新
 */
function update3DLegend() {
    const legendContainer = document.getElementById('simulation3dLegend');
    if (!legendContainer) return;

    legendContainer.innerHTML = '';

    if (simulation3D.animationData.length === 0) {
        legendContainer.innerHTML = '<div style="color: #999; font-size: 12px;">ファイルがありません</div>';
        return;
    }

    simulation3D.animationData.forEach((data) => {
        const colorHex = '#' + data.color.toString(16).padStart(6, '0');

        const legendItem = document.createElement('div');
        legendItem.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 8px; background: white; border-radius: 6px; border: 2px solid ' + colorHex + ';';

        // カラーサークル
        const colorCircle = document.createElement('div');
        colorCircle.style.cssText = 'width: 16px; height: 16px; border-radius: 50%; background: ' + colorHex + '; flex-shrink: 0;';

        // ファイル名
        const fileName = document.createElement('span');
        fileName.style.cssText = 'font-size: 13px; font-weight: 500; color: #333; word-break: break-all;';
        fileName.textContent = data.name;

        // データポイント数
        const dataCount = document.createElement('span');
        dataCount.style.cssText = 'font-size: 11px; color: #666; margin-left: auto; white-space: nowrap;';

        legendItem.appendChild(colorCircle);
        legendItem.appendChild(fileName);
        legendItem.appendChild(dataCount);

        legendContainer.appendChild(legendItem);
    });
}

/**
 * 3D散布図（ポイントクラウド）を作成
 */
function create3DTrajectory(xData, yData, zData, color) {
    const scale = 10; // 固定倍率
    const pointSize = 0.4; // 固定ポイントサイズ
    const opacity = 0.7; // 固定透明度

    // ポイントの位置データを作成
    const positions = new Float32Array(xData.length * 3);
    for (let i = 0; i < xData.length; i++) {
        positions[i * 3] = xData[i] * scale;
        positions[i * 3 + 1] = -zData[i] * scale; // Z軸（負荷）をY軸にマッピング（反転）
        positions[i * 3 + 2] = yData[i] * scale;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // ポイントマテリアル
    const material = new THREE.PointsMaterial({
        color: color,
        size: pointSize,
        transparent: true,
        opacity: opacity,
        sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);

    // userDataに参照を保存（倍率変更時の再構築用）
    points.userData = {
        xData: xData,
        yData: yData,
        zData: zData,
        color: color
    };

    return points;
}

/**
 * 3Dコントロールのイベント設定
 */
function setup3DControls() {
    const viewXYBtn = document.getElementById('viewXY');
    const viewXZBtn = document.getElementById('viewXZ');
    const viewYZBtn = document.getElementById('viewYZ');
    const viewResetBtn = document.getElementById('viewReset');

    // XY平面（上から見る）
    if (viewXYBtn) {
        viewXYBtn.addEventListener('click', () => {
            setCameraView(0, 250, 0);
        });
    }

    // XZ平面（横から見る）
    if (viewXZBtn) {
        viewXZBtn.addEventListener('click', () => {
            setCameraView(0, 0, 250);
        });
    }

    // YZ平面（正面から見る）
    if (viewYZBtn) {
        viewYZBtn.addEventListener('click', () => {
            setCameraView(250, 0, 0);
        });
    }

    // リセット
    if (viewResetBtn) {
        viewResetBtn.addEventListener('click', () => {
            setCameraView(150, 150, 150);
            if (simulation3D.controls) {
                simulation3D.controls.reset();
            }
        });
    }
}

/**
 * カメラ視点を設定
 */
function setCameraView(x, y, z) {
    if (!simulation3D.camera || !simulation3D.controls) return;

    // カメラ位置を設定
    simulation3D.camera.position.set(x, y, z);
    simulation3D.camera.lookAt(0, 0, 0);

    // コントロールのターゲットを更新
    simulation3D.controls.target.set(0, 0, 0);
    simulation3D.controls.update();
}

/**
 * 3D散布図をクリーンアップ
 */
function cleanup3DSimulation() {

    if (simulation3D.renderer) {
        simulation3D.renderer.dispose();
        simulation3D.renderer = null;
    }

    if (simulation3D.scene) {
        simulation3D.scene.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
        simulation3D.scene = null;
    }

    simulation3D.camera = null;
    simulation3D.controls = null;
    simulation3D.drillGroup = null;
    simulation3D.workpiece = null;
    simulation3D.animationData = [];
    simulation3D.currentFrame = 0;
}

// ページ読み込み時に初期化
document.addEventListener('DOMContentLoaded', init);
