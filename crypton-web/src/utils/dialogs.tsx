import { useState, FC, ReactNode } from "react";

export type DialogComponent<P extends Object = {}> = FC<
  {
    close: () => void;
    setOnClose: (close: () => void) => void;
  } & P
>;

export const useDialogs = (): {
  dialogs: ReactNode[];
  pushDialog: (inner: DialogComponent) => void;
} => {
  const [dialogs, setDialogs] = useState<DialogComponent[]>([]);

  const pushDialog = (dialog: DialogComponent) => {
    setDialogs((v) => [...v, dialog]);
  };
  const popDialog = (index: number) => {
    return () => setDialogs((v) => v.splice(index, 1));
  };

  const [onCloses, setOnCloses] = useState<(() => void)[]>([]);
  const setOnClose = (i: number) => {
    return (onClose: () => void) => {
      setOnCloses((s) => [...s.slice(0, i), onClose, ...s.slice(i + 1)]);
    };
  };

  const display = dialogs.map((Fc, i) => {
    return (
      <div className="overlay" onClick={onCloses[i]} key={i}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <Fc close={popDialog(i)} setOnClose={setOnClose(i)} />
        </div>
      </div>
    );
  });

  return { dialogs: display, pushDialog };
};
