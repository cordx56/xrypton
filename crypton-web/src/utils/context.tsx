import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { z } from "zod";
import { useWorkerWaiter } from "@/utils/workerHandler";
import { useServiceWorker } from "@/utils/swHandler";
import { useDialogs } from "@/utils/dialogs";
import { Contacts } from "@/utils/schema";

import InitDialog from "@/components/Dialogs/InitDialog";

type ContextsType = {
  worker?: ReturnType<typeof useWorkerWaiter>;
  dialogs?: ReturnType<typeof useDialogs>;
  privateKeys?: {
    keys: string | undefined;
    setKeys: ReturnType<typeof useState<string | undefined>>[1];
  };
  publicKeys?: {
    keys: string | undefined;
    setKeys: ReturnType<typeof useState<string | undefined>>[1];
  };
  serviceWorker?: ReturnType<typeof useServiceWorker>;
};

const Contexts = createContext<ContextsType>({});

export const getPrivateKeys = () =>
  localStorage.getItem("private_keys") ?? undefined;
export const savePrivateKeys = (v: string) =>
  localStorage.setItem("private_keys", v) ?? undefined;
export const getSubPassphrase = () =>
  localStorage.getItem("sub_passphrase") ?? undefined;
export const saveSubPassphrase = (v: string) =>
  localStorage.setItem("sub_passphrase", v) ?? undefined;

export const getContacts = () => {
  const parsed = Contacts.safeParse(
    JSON.parse(localStorage.getItem("contacts") ?? "{}"),
  );
  return parsed.data ?? {};
};
export const saveContacts = (contacts: z.infer<typeof Contacts>) => {
  localStorage.setItem("contacts", JSON.stringify(contacts));
};

export const ContextProvider = ({ children }: { children: ReactNode }) => {
  const worker = useWorkerWaiter();
  const dialogs = useDialogs();
  const serviceWorker = useServiceWorker();

  const [privateKeys, setPrivateKeys] = useState<string | undefined>(undefined);
  useEffect(() => {
    const pk = getPrivateKeys();
    setPrivateKeys(pk);
    if (pk === undefined) {
      dialogs.pushDialog((p) => <InitDialog {...p} />);
    }
  }, []);
  const [publicKeys, setPublicKeys] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (privateKeys) {
      worker.eventWaiter("export_public_keys", (data) => {
        if (!data.success) {
          return;
        }
        setPublicKeys(data.data.keys);
      });
      worker.postMessage({ call: "export_public_keys", keys: privateKeys });
    }
  }, [privateKeys]);

  return (
    <Contexts.Provider
      value={{
        worker,
        dialogs,
        privateKeys: { keys: privateKeys, setKeys: setPrivateKeys },
        publicKeys: { keys: publicKeys, setKeys: setPublicKeys },
        serviceWorker,
      }}
    >
      {children}
    </Contexts.Provider>
  );
};

export const useContexts = () => {
  const context = useContext(Contexts);
  return context;
};
