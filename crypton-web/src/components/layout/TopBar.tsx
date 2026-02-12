import { ReactNode } from "react";

type Props = {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
};

const TopBar = ({ title, left, right }: Props) => (
  <header className="flex items-center justify-between px-4 py-3 border-b border-accent/30 bg-bg">
    <div className="w-10">{left}</div>
    <h1 className="text-lg font-semibold truncate">{title}</h1>
    <div className="w-10 flex justify-end">{right}</div>
  </header>
);

export default TopBar;
