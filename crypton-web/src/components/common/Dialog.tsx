import { useEffect, ReactNode } from "react";
import type { DialogComponent } from "@/contexts/DialogContext";

const Dialog: DialogComponent<{
  children: ReactNode;
  title?: string;
}> = ({ close, setOnClose, children, title }) => {
  useEffect(() => {
    setOnClose(() => close());
  }, []);

  return (
    <div className="flex flex-col">
      <div className="flex justify-between border-b border-accent px-2 pb-2 mb-4">
        <div className="font-medium">{title ?? ""}</div>
        <button
          type="button"
          onClick={close}
          className="text-muted hover:text-fg"
        >
          X
        </button>
      </div>
      <div className="h-full px-2">{children}</div>
    </div>
  );
};

export default Dialog;
