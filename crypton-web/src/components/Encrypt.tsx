import { useState } from "react";
import { useContexts } from "@/utils/context";
import CommonDialog from "@/components/Dialogs/CommonDialog";
import Code from "@/components/Code";
import QrReader from "@/components/QrReader";

const Encrypt = () => {
  const { worker, dialogs } = useContexts();

  const [publickKeys, setPublicKeys] = useState<string | undefined>(undefined);
  const [payload, setPayload] = useState("");

  const encrypt = () => {
    if (publickKeys) {
      const encoded = Buffer.from(new TextEncoder().encode(payload)).toString(
        "base64",
      );

      worker?.eventWaiter("encrypt", (result) => {
        console.log(result);
        if (result.success) {
          dialogs?.pushDialog((p) => (
            <CommonDialog {...p}>
              <Code code={result.data.message} />
            </CommonDialog>
          ));
        }
      });
      worker?.postMessage({
        call: "encrypt",
        payload: encoded,
        keys: publickKeys,
      });
    }
  };

  return (
    <div>
      {publickKeys ? (
        <div className="flex flex-col text-center">
          <p className="p">Input your message</p>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
          <p className="p">
            <button type="button" className="button" onClick={encrypt}>
              Encrypt
            </button>
          </p>
        </div>
      ) : (
        <div className="text-center">
          <p className="p">Read public key QR</p>
          <QrReader setData={setPublicKeys}></QrReader>
        </div>
      )}
    </div>
  );
};

export default Encrypt;
