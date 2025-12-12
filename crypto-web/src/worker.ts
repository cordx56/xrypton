import init, {
  generate_and_save_private_keys,
  export_public_keys,
} from "../crypto-wasm/pkg/crypto_wasm";
import { WorkerCallMessage, WasmReturnValue } from "@/utils/schema";

init();

/* @ts-ignore */
const worker: Worker = undefined;

worker.addEventListener("message", ({ data }) => {
  const parsed = WorkerCallMessage.safeParse(data);
  if (!parsed.success) {
    return;
  }

  if (parsed.data.call === "generate") {
    const result = WasmReturnValue.safeParse(
      generate_and_save_private_keys(
        parsed.data.userId,
        parsed.data.mainPassphrase,
        parsed.data.subPassphrase,
      ),
    );
    if (result.success === true && result.data.result === "ok") {
      worker.postMessage({
        call: "generate",
        success: result.success === true && result.data.result === "ok",
        data: undefined,
      });
    } else {
      worker.postMessage({
        call: "generate",
        success: false,
        message:
          result.data?.result === "error"
            ? result.data.message
            : "message parse error",
      });
    }
  } else if (parsed.data.call === "export_public_keys") {
    const result = WasmReturnValue.safeParse(export_public_keys());
    if (result.success === false) {
      worker.postMessage({
        call: "export_public_keys",
        success: false,
        message: "message parse error",
      });
      return;
    }
    if (result.data.result === "error") {
      worker.postMessage({
        call: "export_public_keys",
        success: false,
        message: result.data.message,
      });
      return;
    }
    worker.postMessage({
      call: "export_public_keys",
      success: true,
      data: {
        keys: result.data.value?.data,
      },
    });
  }
});
