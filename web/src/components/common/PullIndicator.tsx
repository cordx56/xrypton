/** プルダウン更新のインジケータ。
 *  引っ張り中は矢印、閾値超えで色変化、更新中はスピナーを表示する。 */
const PullIndicator = ({
  pullDistance,
  refreshing,
  threshold,
}: {
  pullDistance: number;
  refreshing: boolean;
  threshold: number;
}) => {
  if (!refreshing && pullDistance <= 0) return null;

  const overThreshold = pullDistance >= threshold;
  const rotation = Math.min((pullDistance / threshold) * 180, 180);

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
      style={{ height: refreshing ? 40 : pullDistance }}
    >
      {refreshing ? (
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      ) : (
        <span
          className={`text-lg transition-colors ${overThreshold ? "text-accent" : "text-muted"}`}
          style={{
            transform: `rotate(${rotation}deg)`,
            display: "inline-block",
          }}
        >
          ↓
        </span>
      )}
    </div>
  );
};

export default PullIndicator;
