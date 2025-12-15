import { useEffect, ReactNode } from "react";
import { DialogComponent } from "@/utils/dialogs";

const CommonDialog: DialogComponent<{
  children: ReactNode;
  title?: string;
}> = ({ close, setOnClose, children, title }) => {
  const onClose = () => close();
  useEffect(() => {
    setOnClose(onClose);
  }, []);
  return (
    <div className="flex flex-col">
      <div className="flex justify-between default-border border-b px-2 pb-2 mb-4">
        <div>{title ? title : null}</div>
        <button type="button" onClick={onClose}>
          X
        </button>
      </div>
      <div className="h-full px-2">{children}</div>
    </div>
  );
};

export default CommonDialog;
