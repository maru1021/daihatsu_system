function initializeAIQuery() {
    const executeBtn = document.getElementById("executeQuery");
    const clearBtn = document.getElementById("clearResults");
    const queryInput = document.getElementById("naturalLanguageQuery");
    const resultDiv = document.getElementById("queryResult");
    const resultInfo = document.getElementById("resultInfo");
    const resultTable = document.getElementById("resultTable");

    // 要素が存在しない場合は初期化をスキップ
    if (!executeBtn || !clearBtn || !queryInput || !resultDiv) {
        return;
    }

    // 既にイベントリスナーが設定済みの場合はスキップ
    if (executeBtn.hasAttribute('data-ai-query-initialized')) {
        return;
    }

    // 初期化済みマークを設定
    executeBtn.setAttribute('data-ai-query-initialized', 'true');

    // Enterキーで実行する
    queryInput.addEventListener("keypress", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            executeBtn.click();
        }
    });

    executeBtn.addEventListener("click", function () {
        const query = queryInput.value.trim();

        if (!query) {
            showToast("error", "質問を入力してください");
            return;
        }

        executeBtn.disabled = true;
        executeBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>考え中...';

        // APIリクエスト（URLは動的に設定される）
        const aiQueryUrl = window.AI_QUERY_URL || '/ai-query/';
        const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;

        fetch(aiQueryUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrfToken,
            },
            body: JSON.stringify({
                query: query,
            }),
        })
        .then((response) => response.json())
        .then((data) => {
            displayResult(data);
        })
        .catch((error) => {
            console.error("Error:", error);
            showToast("error", "エラーが発生しました。");
        })
        .finally(() => {
            executeBtn.disabled = false;
            executeBtn.innerHTML = '<i class="fas fa-search me-2"></i>質問する';
        });
    });

    clearBtn.addEventListener("click", function () {
        queryInput.value = "";
        resultDiv.style.display = "none";
        showToast("success", "クリアしました");
    });

    function displayResult(data) {
        // 既存の結果をクリア
        resultInfo.innerHTML = "";
        resultTable.innerHTML = "";

        if (data.success) {
            // Claude Code の応答を表示
            resultInfo.innerHTML = '';

            // マークダウン形式のテキストをHTMLに変換
            resultTable.innerHTML = `
                <div class="claude-response">
                    ${data.response}
                </div>
            `;

            // 使用量情報がある場合は表示
            if (data.usage) {
                resultInfo.innerHTML += `
                    <div class="alert alert-info mt-2">
                        <i class="fas fa-chart-bar me-2"></i>
                        <strong>使用量:</strong>
                        入力: ${data.usage.input_tokens || 0} tokens,
                        出力: ${data.usage.output_tokens || 0} tokens
                    </div>
                `;
            }
        } else {
            // エラーの場合
            resultInfo.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    <strong>エラー!</strong> ${data.error}
                </div>
            `;
            resultTable.innerHTML = "";
        }

        resultDiv.style.display = "block";
        resultDiv.scrollIntoView({ behavior: "smooth" });
    }
}

// AI Query初期化状態を管理するグローバルオブジェクト
window.AIQueryManager = window.AIQueryManager || {
    initialized: false
};

// HTMXイベントハンドラーを登録する
function setupAIQueryEventHandlers() {
    if (window.AIQueryManager.initialized || typeof $ === 'undefined') {
        return; // 既に初期化済みまたはjQueryが利用不可
    }

    // HTMX遷移後にも再初期化
    $(document).on('htmx:afterSettle', function() {
        if (document.getElementById("executeQuery")) {
            initializeAIQuery();
        }
    });

    window.AIQueryManager.initialized = true;
}

// jQueryが利用可能になってから初期化
function initializeAIQueryWhenReady() {
    if (typeof $ !== 'undefined') {
        // HTMXイベントハンドラー登録
        setupAIQueryEventHandlers();

        // AI Queryページでのみ初期化
        if (document.getElementById("executeQuery")) {
            initializeAIQuery();
        }
    } else {
        // jQueryがまだ利用可能でない場合、少し待ってから再試行
        setTimeout(initializeAIQueryWhenReady, 50);
    }
}

// DOMContentLoadedまたはDOM準備完了時に初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAIQueryWhenReady);
} else {
    // DOMが既に読み込み済みの場合は即座に実行
    initializeAIQueryWhenReady();
}
