import os
import json
import cv2
import numpy as np
from ultralytics import YOLO

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.dirname(os.path.abspath(__file__))

VIDEO_PATH = os.getenv("VIDEO_PATH", os.path.join(BASE_DIR, "videos", "Car-Parking.mp4"))
MODEL_PATH = os.getenv("MODEL_PATH", os.path.join(APP_DIR, "yolo26x-seg.pt"))
PARKING_SPOTS_PATH = os.path.join(APP_DIR, "parking_spots.json")
OUTPUT_VIDEO_PATH = os.path.join(APP_DIR, "parking_output.mp4")




def load_parking_spots():
    if not os.path.exists(PARKING_SPOTS_PATH):
        return None

    with open(PARKING_SPOTS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data.get("spots", [])


def main():
    model = YOLO(MODEL_PATH)
    cap = cv2.VideoCapture(VIDEO_PATH)

    if not cap.isOpened():
        print(f"Could not open video: {VIDEO_PATH}")
        return

    print(f"Input video: {VIDEO_PATH}")

    parking_spots = load_parking_spots()
    has_parking_spots = parking_spots is not None and len(parking_spots) > 0

    frame_skip = 2
    frame_count = 0

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0

    writer = None

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

        if writer is None:
            writer = cv2.VideoWriter(
                OUTPUT_VIDEO_PATH,
                cv2.VideoWriter_fourcc(*"mp4v"),
                max(1.0, fps / frame_skip),
                (new_w, new_h),
            )

        results = model(frame, verbose=False, conf=0.2)

        #Count the detected number of vehicles
        boxes = results[0].boxes
        masks = results[0].masks
        vehicle_count = 0
        car_masks = []

        annotated_frame = frame.copy()

        if boxes is not None:
            for i, box in enumerate(boxes):
                cls = int(box.cls[0])
                label = model.names[cls]

                # Ignore false "clock" detections
                if label == "car":
                    vehicle_count += 1

                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    conf = float(box.conf[0])

                    if masks is not None and i < len(masks.data):
                        mask = masks.data[i].cpu().numpy()
                        mask = cv2.resize(mask, (new_w, new_h), interpolation=cv2.INTER_NEAREST)
                        mask = mask > 0.5
                        car_masks.append(mask.astype(np.uint8))

                        color_mask = np.zeros_like(annotated_frame)
                        color_mask[mask] = (0, 255, 0)
                        annotated_frame = cv2.addWeighted(annotated_frame, 1.0, color_mask, 0.4, 0)

                    cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(
                        annotated_frame,
                        f"car {conf:.2f}",
                        (x1, max(20, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (0, 255, 0),
                        2
                    )

        print("Vehicles detected:", vehicle_count)
        
        if has_parking_spots:
            occupied_spaces = 0
            scaled_spots = []

            for spot in parking_spots:
                polygon = []
                for x, y in spot["polygon"]:
                    polygon.append([
                        int(round(x * (new_w / w))),
                        int(round(y * (new_h / h)))
                    ])
                scaled_spots.append(np.array(polygon, dtype=np.int32))

            for idx, spot in enumerate(scaled_spots, start=1):
                spot_mask = np.zeros((new_h, new_w), dtype=np.uint8)
                cv2.fillPoly(spot_mask, [spot], 1)

                is_occupied = False
                for car_mask in car_masks:
                    overlap = np.logical_and(spot_mask > 0, car_mask > 0).sum()
                    spot_area = max(1, int((spot_mask > 0).sum()))
                    if overlap / spot_area > 0.15:
                        is_occupied = True
                        break

                color = (0, 255, 0)
                if is_occupied:
                    occupied_spaces += 1
                    color = (0, 0, 255)

                cv2.polylines(annotated_frame, [spot], isClosed=True, color=color, thickness=2)

                label_x, label_y = spot[0]
                cv2.putText(
                    annotated_frame,
                    f"{idx}",
                    (label_x + 5, label_y - 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    color,
                    2,
                )

            total_spaces = len(scaled_spots)
            available_spaces = total_spaces - occupied_spaces
        else:
            total_spaces = 0
            available_spaces = 0

        if has_parking_spots:
            cv2.putText(
                annotated_frame,
                f"Occupied: {occupied_spaces}  Available: {available_spaces}",
                (10, 35),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2
            )
        else:
            cv2.putText(
                annotated_frame,
                "No parking spot annotation file found",
                (10, 35),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2
            )

            cv2.putText(
                annotated_frame,
                f"Cars detected: {vehicle_count}",
                (10, 70),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2
            )

        cv2.imshow("YOLO Inference", annotated_frame)
        writer.write(annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    if writer is not None:
        writer.release()
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()