import { useState, useEffect } from "react";
import { z } from "zod";
import { WorkerResultCall, WorkerResultMessage } from "@/utils/schema";

type WorkerResult<T extends WorkerResultCall, U extends z.infer<typeof WorkerResultMessage>> = T extends U["call"] ? U["result"] : never;
export type WorkerEventCallback<T extends WorkerResultCall> = (message: WorkerResult<T, z.infer<typeof WorkerResultMessage>>)=> any;
export type WorkerEventWaiter = <T extends WorkerResultCall>(event: T, callback: WorkerEventCallback<T>) => void;

export const useWorkerWaiter = () => {
  const [messageQueue, setMessageQueue] = useState<z.infer<typeof WorkerResultMessage>[]>([]);
  const [worker, setWorker] = useState<Worker | undefined>(undefined);

  worker?.addEventListener("message", ({ data }) => {
    const parsed = WorkerResultMessage.safeParse(data);
    if (!parsed.success) {
      console.log("invalid Worker message");
      return;
    }
    setMessageQueue((v) => [...v, parsed.data]);
  });

  const [eventWaiter, setEventWaiter] = useState<[WorkerResultCall, WorkerEventCallback<WorkerResultCall>][]>([]);
  const workerEventWaiter = <T extends WorkerResultCall>(event: WorkerResultCall, callback: WorkerEventCallback<T>) => {
    setEventWaiter((v) => [...v, [event, callback]]);
  };
  useEffect(() => {
    for (let i = 0; i < messageQueue.length; i++) {
      for (let j = 0; j < eventWaiter.length; j++) {
        if (messageQueue[i].call === eventWaiter[j][0]) {
          eventWaiter[j][1](messageQueue[i].result);
          setEventWaiter(eventWaiter.splice(j, 1));
          setMessageQueue(messageQueue.splice(i, 1));
        }
      }
    }
  }, [messageQueue]);

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

  return { worker, workerEventWaiter };
};
