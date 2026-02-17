import { QRCodeSVG } from "qrcode.react";

const QrDisplay = ({ data }: { data: string }) => {
  return (
    <div className="m-4 p-4 bg-white">
      <QRCodeSVG value={data} className="w-full h-auto" />
    </div>
  );
};

export default QrDisplay;
