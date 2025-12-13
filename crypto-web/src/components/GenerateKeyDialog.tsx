import { useEffect } from "react";
import { DialogComponent } from "@/utils/dialogs";
import GenerateKey from "@/components/GenerateKey";

const GenerateKeyDialog: DialogComponent = ({ close, setOnClose }) => {
  useEffect(() => {
    setOnClose(() => close());
  }, []);
  return <GenerateKey />;
};

export default GenerateKeyDialog;
