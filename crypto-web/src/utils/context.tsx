import { createContext, useContext, ReactNode } from "react";
import { type WorkerEventWaiter, useWorkerWaiter } from "@/utils/workerHandler";
import { useDialogs } from "@/utils/dialogs";

type ContextsType = {
  worker?: Worker;
  workerEventWaiter?: WorkerEventWaiter;
  dialogs?: ReturnType<typeof useDialogs>;
};

const Contexts = createContext<ContextsType>({});

export const ContextProvider = ({ children }: { children: ReactNode }) => {
  const { worker, workerEventWaiter } = useWorkerWaiter();
  const dialogs = useDialogs();
  return (
    <Contexts.Provider value={{ worker, workerEventWaiter, dialogs }}>
      {children}
    </Contexts.Provider>
  );
};

export const useContexts = () => {
  const context = useContext(Contexts);
  return context;
};
