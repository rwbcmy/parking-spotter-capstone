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

    frame_skip = 2
    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_count += 1
        if frame_count % frame_skip != 0:
            continue

        h, w = frame.shape[:2]
        new_w = 640
        new_h = int(h * (new_w / w))
        frame = cv2.resize(frame, (new_w, new_h))

        results = model(frame, verbose=False, conf=0.2)

        #Count the detected number of vehicles
        boxes = results[0].boxes
        vehicle_count = 0

        for box in boxes:
            cls = int(box.cls[0])
            label = model.names[cls]

            # Ignore false "clock" detections
            if label not in ["clock", "cell phone"]:   
                vehicle_count += 1

        print("Vehicles detected:", vehicle_count)
        
        annotated_frame = results[0].plot()

        total_spaces = 7
        available_spaces = total_spaces - vehicle_count

        cv2.putText(
            annotated_frame,
            f"Occupied: {vehicle_count}  Available: {available_spaces}",
            (10, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (0, 255, 0),
            2
)

        cv2.imshow("YOLO Inference", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()