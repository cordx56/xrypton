type Props = {
  message: string;
  fading: boolean;
  variant: "error" | "success";
  onDismiss: () => void;
};

const ErrorToast = ({ message, fading, variant, onDismiss }: Props) => {
  const toneClass =
    variant === "success" ? "border-green-500/40" : "border-red-500/40";
  const iconClass = variant === "success" ? "text-green-400" : "text-red-400";
  const icon = variant === "success" ? "✓" : "!";

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[min(24rem,calc(100%-2rem))] cursor-pointer ${fading ? "animate-fade-out" : "animate-slide-down"}`}
      onClick={onDismiss}
    >
      <div
        className={`flex items-center gap-3 rounded-xl border bg-bg/95 backdrop-blur-sm px-4 py-3 shadow-lg ${toneClass}`}
      >
        <div className={`text-lg flex-shrink-0 ${iconClass}`}>{icon}</div>
        <div className="min-w-0 flex-1 text-sm">{message}</div>
      </div>
    </div>
  );
};

export default ErrorToast;
