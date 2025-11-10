"""
IP偽装の主な手法:
1. X-Forwarded-For ヘッダー偽装
2. X-Real-IP ヘッダー偽装
3. Client-IP ヘッダー偽装
4. X-Originating-IP ヘッダー偽装
5. 複数プロキシチェーンの偽装
6. Via ヘッダー偽装
"""
import requests
import random
import time
from bs4 import BeautifulSoup


def generate_fake_ip():
    """ランダムなIPアドレスを生成"""
    return f"{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}"


def get_csrf_token(session, url):
    """CSRFトークンを取得"""
    try:
        response = session.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
        csrf_input = soup.find('input', {'name': 'csrfmiddlewaretoken'})
        return csrf_input.get('value') if csrf_input else None
    except Exception as e:
        print(f"❌ CSRFトークン取得エラー: {e}")
        return None


def test_ip_spoofing_methods():
    """各種IP偽装手法をテスト"""
    target_url = "http://127.0.0.1:8000/auth/login"

    # 様々なIP偽装ヘッダーパターン
    spoofing_methods = [
        {
            "name": "X-Forwarded-For 偽装",
            "headers": {"X-Forwarded-For": generate_fake_ip()}
        },
        {
            "name": "X-Real-IP 偽装",
            "headers": {"X-Real-IP": generate_fake_ip()}
        },
        {
            "name": "Client-IP 偽装",
            "headers": {"Client-IP": generate_fake_ip()}
        },
        {
            "name": "X-Originating-IP 偽装",
            "headers": {"X-Originating-IP": generate_fake_ip()}
        },
        {
            "name": "複数プロキシチェーン偽装",
            "headers": {
                "X-Forwarded-For": f"{generate_fake_ip()}, {generate_fake_ip()}, {generate_fake_ip()}",
                "X-Real-IP": generate_fake_ip()
            }
        },
        {
            "name": "Via ヘッダー偽装",
            "headers": {
                "Via": f"1.1 {generate_fake_ip()}:8080",
                "X-Forwarded-For": generate_fake_ip()
            }
        }
    ]

    print("IPアドレス偽装テスト開始")
    print("=" * 60)

    for i, method in enumerate(spoofing_methods, 1):
        print(f"\n🔍 テスト {i}: {method['name']}")

        session = requests.Session()

        # 偽装ヘッダーを設定
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            **method['headers']
        }

        print(f"   偽装ヘッダー: {method['headers']}")

        try:
            # CSRFトークン取得
            csrf_token = get_csrf_token(session, target_url)
            if not csrf_token:
                print("   ❌ CSRFトークン取得失敗")
                continue

            # ログイン試行（偽装IP使用）
            login_data = {
                'username': 'testuser',
                'password': 'wrongpassword',
                'csrfmiddlewaretoken': csrf_token
            }

            response = session.post(
                target_url,
                data=login_data,
                headers=headers,
                allow_redirects=False
            )

            print(f"   送信IP（偽装試行）: {method['headers'].get('X-Forwarded-For', method['headers'].get('X-Real-IP', 'N/A'))}")
            print(f"   レスポンス: HTTP {response.status_code}")

            if response.status_code == 403:
                print("   IPブロック検出")
            elif response.status_code == 423:
                print("   ユーザーロック検出")
            elif response.status_code == 429:
                print("   レート制限検出")
            else:
                print("   通常のレスポンス")

        except Exception as e:
            print(f"   ❌ エラー: {e}")

        # 短時間待機
        time.sleep(0.5)

    print("\n" + "=" * 60)
    print("📋 IP偽装テスト完了")


def test_rapid_ip_switching():
    """高速IP切り替え攻撃をテスト"""
    target_url = "http://127.0.0.1:8000/auth/login"

    print("\n高速IP切り替えテスト開始")
    print("=" * 60)

    for i in range(10):
        fake_ip = generate_fake_ip()

        session = requests.Session()
        headers = {
            'X-Forwarded-For': fake_ip,
            'User-Agent': f'TestBot-{i}/1.0'
        }

        try:
            csrf_token = get_csrf_token(session, target_url)
            if not csrf_token:
                continue

            login_data = {
                'username': f'user{i}',
                'password': 'wrongpass',
                'csrfmiddlewaretoken': csrf_token
            }

            response = session.post(
                target_url,
                data=login_data,
                headers=headers,
                allow_redirects=False
            )

            print(f"試行 {i+1:2d}: IP {fake_ip} → HTTP {response.status_code}")

            if response.status_code in [403, 429]:
                print(f"   防御システムが作動")
                break

        except Exception as e:
            print(f"  エラー: {e}")

        # 高速切り替え（0.1秒間隔）
        time.sleep(0.1)


def test_distributed_attack_simulation():
    """分散攻撃シミュレーション"""
    target_url = "http://127.0.0.1:8000/auth/login"

    print("\n分散攻撃シミュレーション開始")
    print("=" * 60)

    # 異なる地域のIPアドレスレンジ（テスト用）
    ip_ranges = [
        "203.0.113",    # TEST-NET-3
        "198.51.100",   # TEST-NET-2
        "192.0.2",      # TEST-NET-1
        "10.0.0",       # プライベートIP
        "172.16.0",     # プライベートIP
    ]

    for i, base_ip in enumerate(ip_ranges):
        fake_ip = f"{base_ip}.{random.randint(1,254)}"

        session = requests.Session()
        headers = {
            'X-Forwarded-For': fake_ip,
            'X-Real-IP': fake_ip,
            'User-Agent': f'DistributedBot-{i}/1.0 (Region-{i})'
        }

        try:
            csrf_token = get_csrf_token(session, target_url)
            if not csrf_token:
                continue

            login_data = {
                'username': 'admin',
                'password': 'hackme123',
                'csrfmiddlewaretoken': csrf_token
            }

            response = session.post(
                target_url,
                data=login_data,
                headers=headers,
                allow_redirects=False
            )

            print(f"地域 {i+1}: IP {fake_ip} → HTTP {response.status_code}")

        except Exception as e:
            print(f"地域 {i+1} エラー: {e}")

        time.sleep(0.2)


if __name__ == "__main__":
    # 基本的なIP偽装手法テスト
    test_ip_spoofing_methods()

    # 高速IP切り替えテスト
    test_rapid_ip_switching()

    # 分散攻撃シミュレーション
    test_distributed_attack_simulation()

    print("=" * 60)
    print("テスト完了")
    print("- log/security.logで実際に記録されるIPアドレスを確認")
