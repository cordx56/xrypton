import { useState, useEffect } from "react";
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

type WaiterState<T extends WorkerResultCall> = [T, WorkerEventCallback<T>][];

export const useWorkerWaiter = () => {
  const [messageQueue, setMessageQueue] = useState<
    z.infer<typeof WorkerResultMessage>[]
  >([]);
  const [worker, setWorker] = useState<Worker | undefined>(undefined);

  const [eventWaiterQueue, setEventWaiterQueue] = useState<WaiterState<any>>(
    [],
  );
  const eventWaiter = <T extends WorkerResultCall>(
    event: T,
    callback: WorkerEventCallback<T>,
  ) => {
    setEventWaiterQueue((v) => [...v, [event, callback]]);
  };
  useEffect(() => {
    for (let i = 0; i < messageQueue.length; i++) {
      for (let j = 0; j < eventWaiterQueue.length; j++) {
        if (messageQueue[i].call === eventWaiterQueue[j][0]) {
          eventWaiterQueue[j][1](messageQueue[i].result);
          setEventWaiterQueue((v) => v.splice(j, 1));
          setMessageQueue((v) => v.splice(i, 1));
          return;
        }
      }
    }
  }, [messageQueue]);

  const postMessage = (message: z.infer<typeof WorkerCallMessage>) => {
    worker?.postMessage(message);
  };

  useEffect(() => {
    const worker = new Worker(new URL("@/worker", import.meta.url));

    worker.addEventListener("message", ({ data }) => {
      const parsed = WorkerResultMessage.safeParse(data);
      if (!parsed.success) {
        console.log("invalid Worker message");
        return;
      }
      setMessageQueue((v) => [...v, parsed.data]);
    });

    worker.postMessage({ call: "init" });
    setWorker(worker);
  }, []);

  return { worker, eventWaiter, postMessage };
};
