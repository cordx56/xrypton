import { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import {
  WorkerResultCall,
  WorkerResultMessage,
  WorkerCallMessage,
} from "@/utils/schema";

type WorkerResult<T extends WorkerResultCall> = Extract<
  z.infer<typeof WorkerResultMessage>,
  { call: T }
>["result"];

export type WorkerEventCallback<T extends WorkerResultCall> = (
  message: WorkerResult<T>,
) => any;

export type WorkerEventWaiter = <T extends WorkerResultCall>(
  event: T,
  callback: WorkerEventCallback<T>,
) => void;

type WaiterEntry<T extends WorkerResultCall = any> = [
  T,
  WorkerEventCallback<T>,
];

export const useWorkerWaiter = () => {
  const [worker, setWorker] = useState<Worker | undefined>(undefined);
  const waitersRef = useRef<WaiterEntry[]>([]);
  const messageQueueRef = useRef<z.infer<typeof WorkerResultMessage>[]>([]);

  // キューからマッチするメッセージとウェイターを処理する
  const processQueues = useCallback(() => {
    let matched = true;
    while (matched) {
      matched = false;
      for (let i = 0; i < messageQueueRef.current.length; i++) {
        const msg = messageQueueRef.current[i];
        const waiterIdx = waitersRef.current.findIndex(
          ([call]) => call === msg.call,
        );
        if (waiterIdx !== -1) {
          const [, callback] = waitersRef.current[waiterIdx];
          waitersRef.current.splice(waiterIdx, 1);
          messageQueueRef.current.splice(i, 1);
          callback(msg.result);
          matched = true;
          break;
        }
      }
    }
  }, []);

  const eventWaiter: WorkerEventWaiter = useCallback(
    (event, callback) => {
      waitersRef.current.push([event, callback]);
      processQueues();
    },
    [processQueues],
  );

  const postMessage = useCallback(
    (message: z.infer<typeof WorkerCallMessage>) => {
      worker?.postMessage(message);
    },
    [worker],
  );

  useEffect(() => {
    const w = new Worker(new URL("@/worker", import.meta.url));
    w.addEventListener("message", ({ data }) => {
      const parsed = WorkerResultMessage.safeParse(data);
      if (!parsed.success) {
        return;
      }
      messageQueueRef.current.push(parsed.data);
      processQueues();
    });
    w.postMessage({ call: "init" });
    setWorker(w);
    return () => w.terminate();
  }, [processQueues]);

  return { worker, eventWaiter, postMessage };
};
