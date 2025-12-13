"use client";

import { useContexts } from "@/utils/context";
import GenerateKeyDialog from "@/components/GenerateKeyDialog";

export default function Home() {
  const { dialogs } = useContexts();

  return (
    <>
      <div className="centered">
        <button
          className="button"
          onClick={() => dialogs?.pushDialog(GenerateKeyDialog)}
        >
          Generate Keys
        </button>
      </div>
    </>
  );
}
