import { useState } from "react";
import { useContexts, getSubPassphrase } from "@/utils/context";
import CommonDialog from "@/components/Dialogs/CommonDialog";
import Code from "@/components/Code";
import Contacts from "@/components/Contacts";

const Encrypt = () => {
  const { worker, dialogs, privateKeys } = useContexts();

  const [publickKeys, setPublicKeys] = useState<string | undefined>(undefined);
  const [payload, setPayload] = useState("");
  const [passphrase, setPassphrase] = useState(getSubPassphrase() ?? "");

  const encrypt = () => {
    if (publickKeys && privateKeys?.keys && passphrase) {
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
        privateKeys: privateKeys.keys,
        publicKeys: publickKeys,
        passphrase,
      });
    }
  };

  return (
    <div>
      {publickKeys ? (
        <div className="flex flex-col text-center">
          <p className="p">
            passphrase:{" "}
            <input
              type="password"
              className="input-text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </p>
          <p className="p">Input your message</p>
          <textarea
            className="h-24 input-text"
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
        <div>
          <p>Contacts</p>
          <Contacts select={(_keyId, _name, keys) => setPublicKeys(keys)} />
        </div>
      )}
    </div>
  );
};

export default Encrypt;
