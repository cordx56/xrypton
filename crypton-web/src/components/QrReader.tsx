import { useEffect, useState, useRef } from "react";
import QrScanner from "qr-scanner";

const QrReader = ({ setData }: { setData: (data: string) => void }) => {
  const [reading, setReading] = useState(false);

  const qrScanner = useRef<QrScanner | null>(null);
  const videoElem = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (qrScanner.current) {
      qrScanner.current.stop();
    }
    if (videoElem.current) {
      const scanner = new QrScanner(
        videoElem.current,
        (result) => {
          setData(result.data);
          setReading(false);
        },
        {
          calculateScanRegion: (video) => {
            const range = Math.min(video.width, video.height);
            const x = (video.width - range) / 2;
            const y = (video.height - range) / 2;
            return {
              x,
              y,
              width: range,
              height: range,
              downScaledWidth: range,
              downScaledHeight: range,
            };
          },
        },
      );
      if (reading) {
        scanner.start();
      }
      qrScanner.current = scanner;
    }
  }, [reading]);
  useEffect(() => {
    return () => {
      if (qrScanner.current) {
        qrScanner.current.stop();
      }
    };
  }, []);

  return (
    <div className="flex flex-col">
      {reading ? (
        <div className="p-4">
          <video
            ref={videoElem}
            className="w-full h-full aspect-square object-cover"
          />
        </div>
      ) : null}
      <div>
        <button
          type="button"
          className="button"
          onClick={() => setReading((v) => !v)}
        >
          {reading ? "Stop scanning QR" : "Start scanning QR"}
        </button>
      </div>
    </div>
  );
};

export default QrReader;
