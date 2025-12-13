import { useState, useEffect } from "react";

export const useWorker = () => {
  const [worker, setWorker] = useState<Worker | undefined>(undefined);
  useEffect(() => {
    const worker = new Worker(new URL("../worker.ts", import.meta.url));

    const wasmPath = new URL(
      "../../crypto-wasm/pkg/crypto_wasm_bg.wasm",
      import.meta.url,
    ).toString();
    const wasmUrl = new URL(wasmPath, document.baseURI).toString();

    worker.postMessage({ call: "init", wasmUrl });
    setWorker(worker);
  }, []);

  return worker;
};
