"use client";

import { createContext, useContext, useState, ReactNode, FC } from "react";

export type DialogComponent<P extends object = object> = FC<
  {
    close: () => void;
    setOnClose: (close: () => void) => void;
  } & P
>;

type DialogContextType = {
  dialogs: ReactNode[];
  pushDialog: (inner: DialogComponent<any>) => void;
};

const DialogContext = createContext<DialogContextType>({
  dialogs: [],
  pushDialog: () => {},
});

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const [dialogs, setDialogs] = useState<[number, DialogComponent<any>][]>([]);
  const [counter, setCounter] = useState(0);
  const [onCloses, setOnCloses] = useState<[number, () => void][]>([]);

  const incrementCounter = () => {
    setCounter((c) => c + 1);
    return counter + 1;
  };

  const popDialog = (id: number) => {
    return () => {
      setDialogs((v) => v.filter(([i]) => i !== id));
      setOnCloses((v) => v.filter(([i]) => i !== id));
    };
  };

  const pushDialog = (dialog: DialogComponent) => {
    const id = incrementCounter();
    setDialogs((v) => [...v, [id, dialog]]);
    setOnCloses((v) => [...v, [id, () => popDialog(id)]]);
  };

  const setOnClose = (id: number) => {
    return (onClose: () => void) => {
      setOnCloses((s) => [...s.filter(([i]) => i !== id), [id, onClose]]);
    };
  };

  const onClose = (id: number) => {
    const found = onCloses.find(([i]) => i === id);
    if (found) found[1]();
  };

  const display = dialogs.map(([id, Fc], i) => (
    <div className="overlay" onClick={() => onClose(id)} key={i}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <Fc close={popDialog(id)} setOnClose={setOnClose(id)} />
      </div>
    </div>
  ));

  return (
    <DialogContext.Provider value={{ dialogs: display, pushDialog }}>
      {children}
    </DialogContext.Provider>
  );
};

export const useDialogs = () => useContext(DialogContext);
