import { useState, FC, ReactNode } from "react";

export type DialogComponent<P extends Object = {}> = FC<
  {
    close: () => void;
    setOnClose: (close: () => void) => void;
  } & P
>;

export const useDialogs = (): {
  dialogs: ReactNode[];
  pushDialog: (inner: DialogComponent<any>) => void;
} => {
  const [dialogs, setDialogs] = useState<[number, DialogComponent<any>][]>([]);
  const [counter, setCounter] = useState(0);
  const incrementCounter = () => {
    setCounter(counter + 1);
    return counter + 1;
  };
  const [onCloses, setOnCloses] = useState<[number, () => void][]>([]);

  const popDialog = (id: number) => {
    return () => {
      setDialogs((v) => v.filter(([i, _c]) => i !== id));
      setOnCloses((v) => v.filter(([i, _v]) => i !== id));
    };
  };
  const pushDialog = (dialog: DialogComponent) => {
    const id = incrementCounter();
    setDialogs((v) => [...v, [id, dialog]]);
    setOnCloses((v) => [...v, [id, () => popDialog(id)]]);
  };

  const setOnClose = (id: number) => {
    return (onClose: () => void) => {
      setOnCloses((s) => [...s.filter(([i, _v]) => i !== id), [id, onClose]]);
    };
  };
  const onClose = (id: number) => {
    onCloses.filter(([i, _v]) => i === id)[0][1]();
  };

  const display = dialogs.map(([id, Fc], i) => {
    return (
      <div className="overlay" onClick={() => onClose(id)} key={i}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <Fc close={popDialog(id)} setOnClose={setOnClose(id)} />
        </div>
      </div>
    );
  });

  return { dialogs: display, pushDialog };
};
