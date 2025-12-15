import { useState } from "react";
import { useContexts } from "@/utils/context";
import CommonDialog from "@/components/Dialogs/CommonDialog";
import Code from "@/components/Code";

const Decrypt = () => {
  const { worker, dialogs, privateKeys } = useContexts();

  const [passPhrase, setPassPhrase] = useState<string>("");
  const [message, setMessage] = useState("");

  const decrypt = () => {
    if (privateKeys?.keys) {
      worker?.eventWaiter("decrypt", (result) => {
        if (result.success) {
          const text = new TextDecoder().decode(
            Buffer.from(result.data.payload, "base64"),
          );
          dialogs?.pushDialog((p) => (
            <CommonDialog {...p}>
              <Code code={text} />
            </CommonDialog>
          ));
        }
      });
      worker?.postMessage({
        call: "decrypt",
        passPhrase,
        keys: privateKeys.keys,
        message,
      });
    }
  };

  return (
    <div className="flex flex-col text-center">
      <p className="p">
        passphrase:{" "}
        <input
          type="password"
          className="input-text"
          value={passPhrase}
          onChange={(e) => setPassPhrase(e.target.value)}
        />
      </p>
      <p className="p">Input encrypted message</p>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
      <p className="p">
        <button type="button" className="button" onClick={decrypt}>
          Decrypt
        </button>
      </p>
    </div>
  );
};

export default Decrypt;
