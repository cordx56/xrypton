/** ISO 8601文字列をローカルタイムゾーンの日時文字列に変換する */
export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** ISO 8601文字列をローカルタイムゾーンの日付文字列に変換する */
export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString();

/** ISO 8601文字列をローカルタイムゾーンの時刻文字列に変換する */
export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
