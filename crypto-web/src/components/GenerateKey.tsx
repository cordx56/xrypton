import { useState } from "react";
import { z } from "zod";
import { WorkerCallMessage } from "@/utils/schema";
import { useContexts } from "@/utils/context";

const GenerateKey = () => {
  const { worker } = useContexts();

  const [userId, setUserId] = useState("");
  const [mainPassphrase, setMainPassphrase] = useState("");
  const [subPassphrase, setSubPassphrase] = useState("");

  const generate = () => {
    const message: z.infer<typeof WorkerCallMessage> = {
      call: "generate",
      userId,
      mainPassphrase,
      subPassphrase,
    };
    worker?.postMessage(message);
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 items-center">
        <div className="col-span-3 sm:col-span-1">User ID:</div>
        <div className="col-span-3 sm:col-span-2">
          <input
            className="input-text w-full"
            type="text"
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
        <div className="col-span-3 sm:col-span-1">Main passphrase:</div>
        <div className="col-span-3 sm:col-span-2">
          <input
            className="input-text w-full"
            type="password"
            onChange={(e) => setMainPassphrase(e.target.value)}
          />
        </div>
        <div className="col-span-3 sm:col-span-1">Sub passphrase:</div>
        <div className="col-span-3 sm:col-span-2">
          <input
            className="input-text w-full"
            type="password"
            onChange={(e) => setSubPassphrase(e.target.value)}
          />
        </div>
      </div>
      <div>
        <button className="button" type="button" onClick={generate}>
          Generate Key
        </button>
      </div>
    </div>
  );
};

export default GenerateKey;
