import { useState } from "react";
import { z } from "zod";
import { WorkerCallMessage } from "../utils/schema";

const GenerateKey = (worker: Worker) => {
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
    worker.postMessage(message);
  };

  return (
    <div>
      <p className="p">
        User ID:
        <input
          className="input-text"
          type="text"
          onChange={(e) => setUserId(e.target.value)}
        />
      </p>
      <p className="p">
        Main passphrase:
        <input
          className="input-text"
          type="password"
          onChange={(e) => setMainPassphrase(e.target.value)}
        />
      </p>
      <p className="p">
        Sub passphrase:
        <input
          className="input-text"
          type="password"
          onChange={(e) => setSubPassphrase(e.target.value)}
        />
      </p>
      <p className="p">
        <button className="button" type="button" onClick={generate}>
          Generate Key
        </button>
      </p>
    </div>
  );
};

export default GenerateKey;
