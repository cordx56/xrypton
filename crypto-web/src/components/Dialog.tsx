import { ReactNode } from "react";

const Dialog = ({ children }: { children: ReactNode }) => {
  return (
    <div className="overlay">
      <div className="dialog">{children}</div>
    </div>
  );
};

export default Dialog;
