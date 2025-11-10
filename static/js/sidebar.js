$(function () {
    const STORAGE_KEY = "sidebarState";

    const getStoredState = () => {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
        } catch {
            return {};
        }
    };

    // サイドバーの状態を保存
    const saveCurrentDOMState = () => {
        const state = {};
        $(".collapse").each((i, el) => {
            state[el.id] = $(el).hasClass("show");
        });
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    };

    // サイドバーの状態を復元
    const restoreStates = () => {
        const state = getStoredState();

        Object.keys(state).forEach((elementId) => {
            const $element = $("#" + elementId);
            const $trigger = $(`[data-bs-target="#${elementId}"]`);
            const shouldBeOpen = state[elementId];
            const isCurrentlyOpen = $element.hasClass("show");

            if ($element.length && shouldBeOpen !== isCurrentlyOpen) {
                if (shouldBeOpen) {
                    $element.addClass("show");
                    $trigger.attr("aria-expanded", "true");
                } else {
                    $element.removeClass("show");
                    $trigger.attr("aria-expanded", "false");
                }
            }
        });
    };

    $(".collapse").on("shown.bs.collapse hidden.bs.collapse", function () {
        saveCurrentDOMState();
    });

    setTimeout(() => {
        restoreStates();
    }, 0);

    // サイドバーのスクロール制御
    function initSidebarScroll() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        // マウスホイールイベント
        sidebar.addEventListener('wheel', function(e) {
            const scrollTop = sidebar.scrollTop;
            const scrollHeight = sidebar.scrollHeight;
            const height = sidebar.clientHeight;
            const delta = e.deltaY;

            // サイドバー内でスクロール可能な場合のみ制御
            if (scrollHeight > height) {
                // サイドバーの端に達している場合のみメインコンテンツへのスクロールを防ぐ
                if ((scrollTop === 0 && delta < 0) ||
                    (scrollTop + height >= scrollHeight && delta > 0)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }, { passive: false });

        // タッチスクロール制御（モバイル対応）
        sidebar.addEventListener('touchmove', function(e) {
            const scrollHeight = sidebar.scrollHeight;
            const height = sidebar.clientHeight;

            if (scrollHeight > height) {
                e.stopPropagation();
            }
        }, { passive: false });
    }

    // 初期化
    initSidebarScroll();

    // HTMX遷移後に再初期化
    document.addEventListener('htmx:afterSettle', function() {
        initSidebarScroll();
    });
});
