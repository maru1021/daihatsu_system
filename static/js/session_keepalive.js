/**
 * セッションKeep-Alive機能
 * 1週間に1回セッション更新リクエストを送信
 */
document.addEventListener('DOMContentLoaded', function() {
    // 1週間 = 7日 × 24時間 × 60分 × 60秒 × 1000ms
    const KEEP_ALIVE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 1週間

    function keepSessionAlive() {
        // CSRFトークンを取得
        const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]");
        if (!csrfToken) {
            console.warn('CSRFトークンが見つかりません');
            return;
        }

        fetch('/keep-session-alive/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken.value
            }
        })
        .then(response => {
            if (!response.ok) {
                console.warn(`セッション更新失敗: ${response.status} ${response.statusText}`);
            }
        })
        .catch(error => {
            console.warn('セッション更新エラー:', error);
        });
    }

    // 1週間毎にKeep-Alive実行
    setInterval(keepSessionAlive, KEEP_ALIVE_INTERVAL);

    // 初回は30秒後に実行（サーバー起動確認用）
    setTimeout(keepSessionAlive, 30000);
});
