import { defaultUrlTransform } from 'react-markdown';

export type LinkTarget = { kind: 'external'; href: string } | { kind: 'path'; path: string };

// 모델은 로컬 파일을 `C:/dir/file.ts:12` 형태로 인용한다. 브라우저는 이를 열 수 없고
// react-markdown 기본 변환은 알 수 없는 scheme("c:")의 href를 빈 값으로 지워 페이지 루트로 연결되므로,
// http(s)/mailto/앵커만 링크로 두고 나머지는 클릭되지 않는 일반 경로로 표시한다.
export function linkTarget(href: string | undefined): LinkTarget {
  const value = (href ?? '').trim();
  if (/^(https?:\/\/|mailto:|#)/i.test(value)) return { kind: 'external', href: value };
  return { kind: 'path', path: value };
}

// href는 linkTarget이 걸러내도록 그대로 두고, 그 외 속성(src 등)은 기본 sanitize를 유지한다.
export const keepHref = (url: string, key: string) => (key === 'href' ? url : defaultUrlTransform(url));
