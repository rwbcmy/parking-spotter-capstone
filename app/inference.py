import os
import cv2
from ultralytics import YOLO

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VIDEO_PATH = os.getenv("VIDEO_PATH", os.path.join(BASE_DIR, "videos", "Car-Parking.mp4"))
MODEL_PATH = os.getenv("MODEL_PATH", "yolo12n.pt")


def main():
    model = YOLO(MODEL_PATH)
    cap = cv2.VideoCapture(VIDEO_PATH)

    if not cap.isOpened():
        print(f"Could not open video: {VIDEO_PATH}")
        return

    print(f"Input video: {VIDEO_PATH}")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        h, w = frame.shape[:2]
        new_w = 640
        new_h = int(h * (new_w / w))
        frame = cv2.resize(frame, (new_w, new_h))

        results = model(frame, verbose=False, conf=0.2, classes=[2, 3, 5, 7])
        annotated_frame = results[0].plot()

        cv2.imshow("YOLO Inference", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()