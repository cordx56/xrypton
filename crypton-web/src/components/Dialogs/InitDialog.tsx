import { useEffect } from "react";
import { useContexts } from "@/utils/context";
import { DialogComponent } from "@/utils/dialogs";
import GenerateKey from "@/components/GenerateKey";

const InitDialog: DialogComponent<{}> = ({ close, setOnClose }) => {
  const { privateKeys } = useContexts();
  useEffect(() => {
    if (privateKeys?.keys) {
      close();
    }
  }, [privateKeys?.keys]);

  useEffect(() => {
    setOnClose(() => {});
  }, []);

  return (
    <div className="flex flex-col">
      <p className="p">First, you have to generate your keys.</p>
      <div>
        <GenerateKey />
      </div>
    </div>
  );
};

export default InitDialog;
