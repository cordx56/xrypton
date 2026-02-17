import { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label?: string;
};

const IconButton = ({ children, label, className = "", ...props }: Props) => (
  <button
    type="button"
    className={`p-2 rounded-lg hover:bg-accent/20 transition-colors ${className}`}
    title={label}
    {...props}
  >
    {children}
  </button>
);

export default IconButton;
