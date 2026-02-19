"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
  FC,
} from "react";

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
  // popstateハンドラからの close 呼び出しかどうかを追跡
  const closingFromPopState = useRef(false);

  const incrementCounter = () => {
    setCounter((c) => c + 1);
    return counter + 1;
  };

  const popDialog = (id: number) => {
    return () => {
      setDialogs((v) => v.filter(([i]) => i !== id));
      setOnCloses((v) => v.filter(([i]) => i !== id));
      // popstate 経由でない場合のみ履歴エントリを戻す
      if (!closingFromPopState.current) {
        history.back();
      }
    };
  };

  const pushDialog = (dialog: DialogComponent) => {
    const id = incrementCounter();
    history.pushState({ dialogId: id }, "");
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

  // ブラウザバックで最前面のダイアログを閉じる
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs;
  const onClosesRef = useRef(onCloses);
  onClosesRef.current = onCloses;

  const handlePopState = useCallback(() => {
    const current = dialogsRef.current;
    if (current.length === 0) return;
    const topId = current[current.length - 1][0];
    closingFromPopState.current = true;
    const found = onClosesRef.current.find(([i]) => i === topId);
    if (found) found[1]();
    closingFromPopState.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [handlePopState]);

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
