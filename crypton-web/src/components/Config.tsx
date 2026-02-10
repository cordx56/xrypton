import { useContexts } from "@/utils/context";
import CommonDialog from "@/components/Dialogs/CommonDialog";
import GenerateKey from "@/components/GenerateKey";

const Config = () => {
    const { dialogs } = useContexts();
    return (
        <div>
            <p className="p">
                <button
                    className="button"
                    onClick={() =>
                        dialogs?.pushDialog((p) => (
                            <CommonDialog {...p}>
                                <GenerateKey />
                            </CommonDialog>
                        ))
                    }
                >
                    Regenerate keys
                </button>
            </p>
        </div>);
};

export default Config;
