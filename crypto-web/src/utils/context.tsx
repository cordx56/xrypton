import { createContext, useContext, ReactNode } from "react";
import { useWorker } from "@/utils/workerHandler";
import { useDialogs } from "@/utils/dialogs";

type ContextsType = {
  worker?: Worker;
  dialogs?: ReturnType<typeof useDialogs>;
};

const Contexts = createContext<ContextsType>({});

export const ContextProvider = ({ children }: { children: ReactNode }) => {
  const worker = useWorker();
  const dialogs = useDialogs();
  return (
    <Contexts.Provider value={{ worker, dialogs }}>
      {children}
    </Contexts.Provider>
  );
};

export const useContexts = () => {
  const context = useContext(Contexts);
  return context;
};
