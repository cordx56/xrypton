import Avatar from "./Avatar";

type Props = {
  displayName: string;
  iconUrl: string | null;
  iconSignature?: string | null;
  publicKey?: string;
  body: string;
  fading: boolean;
  onDismiss: () => void;
};

const NotificationBanner = ({
  displayName,
  iconUrl,
  iconSignature,
  publicKey,
  body,
  fading,
  onDismiss,
}: Props) => {
  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[min(24rem,calc(100%-2rem))] cursor-pointer ${fading ? "animate-fade-out" : "animate-slide-down"}`}
      onClick={onDismiss}
    >
      <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-bg/95 backdrop-blur-sm px-4 py-3 shadow-lg">
        <Avatar
          name={displayName}
          iconUrl={iconUrl}
          iconSignature={iconSignature}
          publicKey={publicKey}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{displayName}</div>
          <div className="text-xs text-muted truncate">{body}</div>
        </div>
      </div>
    </div>
  );
};

export default NotificationBanner;
