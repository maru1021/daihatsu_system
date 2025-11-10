from scapy.all import IP, TCP, sr1, send

def tcp_handshake():
    """TCP 3-Way Handshake"""

    print("=== TCP 3-Way Handshake 開始 ===")

    # ステップ1: SYN送信
    syn_packet = (IP(src="127.0.0.1", dst="127.0.0.1") /
                  TCP(sport=1024,
                      dport=8000,
                      flags="S",        # SYNフラグ
                      seq=1000))        # 初期シーケンス番号

    syn_response = sr1(syn_packet, timeout=5, verbose=False)

    if not syn_response:
        print("❌ SYN-ACK受信失敗")
        return None

    # ステップ2: SYN-ACK確認
    if syn_response[TCP].flags == 18:  # SYN+ACK = 18
        server_seq = syn_response[TCP].seq
        server_ack = syn_response[TCP].ack
        print(f"サーバーSEQ: {server_seq}")
        print(f"サーバーACK: {server_ack}")
    else:
        print("SYN-ACKではない応答")
        return None

    # ステップ3: ACK送信
    client_seq = server_ack           # サーバーが期待するSEQ
    client_ack = server_seq + 1       # サーバーのSEQ + 1

    ack_packet = (IP(src="127.0.0.1", dst="127.0.0.1") /
                  TCP(sport=1024,
                      dport=8000,
                      flags="A",                        # ACKフラグ
                      seq=client_seq,                   # サーバーが期待するSEQ
                      ack=client_ack))                  # サーバーのSEQ + 1

    print(f"送信: ACK (seq={client_seq}, ack={client_ack})")
    send(ack_packet, verbose=False)

    print("TCP接続確立完了!")

    # HTTP通信に必要な情報を返す
    connection_info = {
        'src_ip': '127.0.0.1',
        'dst_ip': '127.0.0.1',
        'src_port': 1024,
        'dst_port': 8000,
        'next_seq': client_seq,    # 次に使うSEQ番号
        'next_ack': client_ack     # 次に使うACK番号
    }

    return connection_info

def send_http_request(connection_info):
    """HTTP GETリクエストの送信"""

    if not connection_info:
        print("❌ TCP接続情報がありません")
        return False

    print("\n=== HTTP GETリクエスト送信 ===")

    # HTTP GETリクエストの作成
    http_request = "GET / HTTP/1.1\r\nHost: 127.0.0.1:8000\r\nConnection: close\r\n\r\n"

    print("HTTPリクエスト内容:")
    print(repr(http_request))

    # HTTPリクエストをTCPパケットに載せる
    http_packet = (IP(src=connection_info['src_ip'], dst=connection_info['dst_ip']) /
                   TCP(sport=connection_info['src_port'],
                       dport=connection_info['dst_port'],
                       flags="PA",                      # PSH+ACK (データ送信)
                       seq=connection_info['next_seq'], # TCP接続で確立した次のSEQ
                       ack=connection_info['next_ack']) / # TCP接続で確立した次のACK
                   http_request)

    print(f"送信: HTTP GET (seq={connection_info['next_seq']}, ack={connection_info['next_ack']})")

    # HTTPレスポンスの受信
    http_response = sr1(http_packet, timeout=10, verbose=False)

    if http_response:
        print("HTTPレスポンス受信成功!")

        # レスポンスの詳細表示
        print(f"\nTCP応答情報:")
        print(f"  フラグ: {http_response[TCP].flags}")
        print(f"  サーバーSEQ: {http_response[TCP].seq}")
        print(f"  サーバーACK: {http_response[TCP].ack}")

        # HTTPレスポンス内容の表示
        if http_response.haslayer('Raw'):
            response_data = http_response['Raw'].load.decode('utf-8', errors='ignore')

            print(f"\n=== HTTPレスポンス内容 ===")
            print(response_data)
            print("=" * 50)

            # ステータスコードの確認
            if "200 OK" in response_data:
                print("🎉 HTTP 200 OK - ページ取得成功!")
            elif "404" in response_data:
                print("📄 HTTP 404 - ページが見つかりません")
            elif "500" in response_data:
                print("⚠️ HTTP 500 - サーバーエラー")
            else:
                print("📄 HTTPレスポンス受信完了")

            return True
        else:
            print("⚠️ HTTPデータが含まれていません")
            return False
    else:
        print("❌ HTTPレスポンス受信失敗")
        return False

def main():
    """メイン実行関数"""

    print("TCP接続 + HTTP通信のテスト")
    print("=" * 40)

    # 1. TCP接続を確立
    connection_info = tcp_handshake()

    if connection_info:
        print(f"\n取得した接続情報:")
        for key, value in connection_info.items():
            print(f"  {key}: {value}")

        # 2. HTTP通信を実行
        success = send_http_request(connection_info)

        if success:
            print("全ての通信が成功しました!")
        else:
            print("HTTP通信で問題が発生しました")
    else:
        print("TCP接続の確立に失敗しました")

# 実行
if __name__ == "__main__":
    main()
