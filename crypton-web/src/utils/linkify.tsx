import type { ReactNode } from "react";

// URLを検出してリンクに変換するユーティリティ
// 国際化ドメイン名(IDN)やパス中の非ASCII文字にも対応

// Unicode文字クラスを含むURLパターン
// - プロトコル付き: https://example.com/パス
// - wwwプレフィックス: www.example.com
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'()]*[^\s<>"'().,;:!?\]})]/gu;

/**
 * テキスト中のURLをaタグに変換し、ReactNodeの配列として返す
 */
export function linkify(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0];
    const index = match.index;

    // マッチ前のテキスト
    if (index > lastIndex) {
      result.push(text.slice(lastIndex, index));
    }

    // www始まりにはhttps://を補完
    const href = url.startsWith("www.") ? `https://${url}` : url;

    result.push(
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline break-all"
      >
        {url}
      </a>,
    );

    lastIndex = index + url.length;
  }

  // 残りのテキスト
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}
