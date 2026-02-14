import { useState } from "react";

const Code = ({ code }: { code: string }) => {
  const [copyMessage, setCopyMessage] = useState("Copy");
  const [showButton, setShowButton] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopyMessage("Copied!");
    setTimeout(() => {
      setCopyMessage("Copy");
    }, 3000);
  };

  return (
    <div className="group relative" onClick={() => setShowButton((v) => !v)}>
      <pre className="overflow-auto">
        <code>{code}</code>
        <button
          type="button"
          className={`button sticky top-0 right-0 float-right opacity-0 group-hover:opacity-100 ${showButton ? "opacity-100" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            copy();
          }}
        >
          {copyMessage}
        </button>
      </pre>
    </div>
  );
};

export default Code;
