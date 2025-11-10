import cv2
from datetime import datetime
import os
import json



class DetectionConfig:
    def __init__(self, config_path="detection_config.json"):
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)

    def get(self, *keys):
        result = self.config
        for key in keys:
            result = result[key]
        return result


# 動作検出
class SimpleCameraDetector:
    def __init__(self, config_path="detection_config.json"):
        self.cap = None
        self.config = DetectionConfig(config_path)

    # カメラアクセステスト
    def test_camera_access(self):
        camera_range = self.config.get('camera', 'camera_id_range')
        for camera_id in range(camera_range):
            cap = cv2.VideoCapture(camera_id)

            if cap.isOpened():
                ret, frame = cap.read()
                if ret:
                    cap.release()
                    return camera_id

            cap.release()
        return None

    # アラートエリア検知
    def check_alert_zone(self, detections, frame_width, frame_height):
        """アラートエリアの動体チェック"""
        violations = []

        x_ratio = self.config.get('alert', 'zone', 'x_ratio')
        y_ratio = self.config.get('alert', 'zone', 'y_ratio')
        alert_x = int(frame_width * x_ratio)
        alert_y = int(frame_height * y_ratio)

        for detection in detections:
            x, y, w, h = detection['bbox']
            center_x = x + w // 2
            center_y = y + h // 2

            if center_x <= alert_x and center_y <= alert_y:
                violations.append(detection)

        return violations

    # アラーム機能
    def trigger_alarm(self, violations, frame=None):
        """アラーム発動"""
        if violations and self.config.get('alert', 'alarm', 'enabled'):
            console_msg = self.config.get('alert', 'alarm', 'console_message')
            print(console_msg.format(count=len(violations)))

            # 自動スクリーンショット
            if frame is not None and self.config.get('alert', 'alarm', 'auto_screenshot'):
                self.save_detection_screenshot(frame, len(violations))

            try:
                sound_msg = self.config.get('alert', 'alarm', 'sound_message')
                os.system(f'say "{sound_msg}"')
            except:
                print("アラーム音再生できません")

    # スクリーンショット保存
    def save_detection_screenshot(self, frame, detection_count):
        """検知時のスクリーンショットを保存"""
        try:
            # スクリーンショットフォルダ作成
            screenshot_path = self.config.get('alert', 'alarm', 'screenshot_path')
            if not os.path.exists(screenshot_path):
                os.makedirs(screenshot_path)

            # ファイル名生成（タイムスタンプ + 検知数）
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{screenshot_path}/detection_{timestamp}_{detection_count}objects.jpg"

            # スクリーンショット保存
            cv2.imwrite(filename, frame)
            print(f"スクリーンショット保存: {filename}")

        except Exception as e:
            print(f"スクリーンショット保存エラー: {e}")

    # 警戒エリア表示
    def draw_alert_zone(self, frame, width, height):
        """警戒エリアを画面に描画"""
        # 設定からエリアサイズを取得
        x_ratio = self.config.get('alert', 'zone', 'x_ratio')
        y_ratio = self.config.get('alert', 'zone', 'y_ratio')
        color = self.config.get('display', 'alert_zone_color')

        alert_x = int(width * x_ratio)
        alert_y = int(height * y_ratio)

        # アラートエリアに枠を描画
        cv2.rectangle(frame, (0, 0), (alert_x, alert_y), color, 3)
        cv2.putText(frame, "ALERT ZONE (MOTION ONLY)", (10, 25),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

    # 物体検出開始
    def start_detection(self, camera_id=0):
        self.cap = cv2.VideoCapture(camera_id)

        # カメラ設定
        width = self.config.get('camera', 'width')
        height = self.config.get('camera', 'height')
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

        # 背景差分検出器設定
        motion_config = self.config.get('detection', 'motion')
        back_sub = cv2.createBackgroundSubtractorMOG2(
            history=motion_config['history'],
            varThreshold=motion_config['var_threshold'],
            detectShadows=motion_config['detect_shadows']
        )

        frame_count = 0
        detection_count = 0

        try:
            while True:
                ret, frame = self.cap.read()
                if not ret:
                    break

                frame_count += 1
                original_frame = frame.copy()
                height, width = frame.shape[:2]

                # 警戒エリアを先に描画
                self.draw_alert_zone(original_frame, width, height)

                # 動体検出
                motion_detections = self.detect_motion(frame, back_sub)

                # 動体検出のみ使用（軽量・高速）
                all_detections = motion_detections
                detection_count += len(all_detections)

                # 検出結果を描画
                result_frame = self.draw_detections(original_frame, all_detections)

                # アラートエリアチェック & アラーム
                alert_violations = self.check_alert_zone(all_detections, width, height)
                self.trigger_alarm(alert_violations, result_frame)

                # 情報表示
                self.add_info_overlay(result_frame)

                # フレーム表示
                window_name = self.config.get('display', 'window_name')
                cv2.imshow(window_name, result_frame)

                # キー操作
                key = cv2.waitKey(1) & 0xFF
                if key == 27:  # ESC
                    break
                elif key == ord(' '):  # スペース（背景リセット）
                    back_sub = cv2.createBackgroundSubtractorMOG2(
                        history=motion_config['history'],
                        varThreshold=motion_config['var_threshold'],
                        detectShadows=motion_config['detect_shadows']
                    )
                elif key == ord('s'):  # スクリーンショット
                    filename = f"detection_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
                    cv2.imwrite(filename, result_frame)

        finally:
            self.cap.release()
            cv2.destroyAllWindows()

        return True

    def detect_motion(self, frame, back_sub):
        """動体検出"""
        detections = []

        # 背景差分
        fg_mask = back_sub.apply(frame)

        # ノイズ除去
        motion_config = self.config.get('detection', 'motion')
        kernel_size = tuple(motion_config['morph_kernel_size'])
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, kernel_size)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)

        # 輪郭検出
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            area = cv2.contourArea(contour)
            min_area = motion_config['min_area']
            if area > min_area:
                x, y, w, h = cv2.boundingRect(contour)

                # 形状フィルタ
                aspect_ratio = w / h if h > 0 else 0
                extent = area / (w * h) if (w * h) > 0 else 0
                aspect_range = motion_config['aspect_ratio_range']
                extent_threshold = motion_config['extent_threshold']

                if aspect_range[0] <= aspect_ratio <= aspect_range[1] and extent > extent_threshold:
                    detections.append({
                        'type': 'motion',
                        'bbox': [x, y, w, h],
                        'area': int(area),
                        'confidence': min(area / min_area, 1.0)
                    })

        return detections


    def draw_detections(self, frame, detections):
        """検出結果を四角で描画"""
        result_frame = frame.copy()

        # 色設定を設定ファイルから取得
        colors_config = self.config.get('display', 'colors')
        colors = {key: tuple(value) for key, value in colors_config.items()}

        for detection in detections:
            x, y, w, h = detection['bbox']
            det_type = detection['type']
            confidence = detection.get('confidence', 0.5)

            # 色選択
            color = colors.get(det_type, colors['default'])

            # 四角形描画（太い線）
            cv2.rectangle(result_frame, (x, y), (x + w, y + h), color, 3)

            # ラベル描画
            area = detection.get('area', 0)
            label = f"Motion: {area}"

            # ラベル背景
            label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
            cv2.rectangle(result_frame, (x, y - label_size[1] - 10),
                         (x + label_size[0], y), color, -1)

            # ラベルテキスト
            cv2.putText(result_frame, label, (x, y - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        return result_frame

    def add_info_overlay(self, frame):
        """表示する情報追加"""

        # 現在時刻
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cv2.putText(frame, timestamp, (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)


def main():
    detector = SimpleCameraDetector("detection_config.json")

    camera_id = detector.test_camera_access()

    if camera_id is None:
        print("カメラにアクセスできません")
        return False

    print("カメラ検出成功 - 左上エリア監視開始")
    print("左上エリアに物体が入るとアラームが鳴ります")

    # 物体検出開始
    detector.start_detection(camera_id)

    return True


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"エラーが発生しました: {e}")
        import traceback
        traceback.print_exc()
