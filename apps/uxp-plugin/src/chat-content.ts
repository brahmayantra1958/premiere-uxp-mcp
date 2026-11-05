export type AttachmentKind = "text" | "image" | "file";

export type ChatAttachment = {
  id: string;
  name: string;
  nativePath: string;
  kind: AttachmentKind;
  text?: string;
  truncated?: boolean;
};

export type PremiereChatContext = {
  projectName?: string;
  projectPath?: string;
  sequenceName?: string;
};

const IMAGE_EXTENSIONS = new Set(["bmp", "gif", "heic", "jpeg", "jpg", "png", "psd", "tif", "tiff", "webp"]);
const TEXT_EXTENSIONS = new Set([
  "ass", "csv", "css", "html", "ini", "js", "json", "jsx", "log", "md", "mjs", "mts", "srt",
  "svg", "toml", "ts", "tsx", "txt", "vtt", "xml", "yaml", "yml",
]);

export function classifyAttachment(name: string): AttachmentKind {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "file";
}

export function parentDirectory(nativePath: string): string | undefined {
  const normalized = nativePath.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (separator <= 0) return undefined;
  return normalized.slice(0, separator);
}

export function attachmentDirectories(attachments: ChatAttachment[]): string[] {
  const directories = new Set<string>();
  for (const attachment of attachments) {
    const directory = parentDirectory(attachment.nativePath);
    if (directory) directories.add(directory);
  }
  return [...directories];
}

export function buildModelPrompt(
  message: string,
  attachments: ChatAttachment[],
  premiereContext?: PremiereChatContext,
): string {
  const parts: string[] = [];
  const normalizedMessage = message.trim();
  parts.push(normalizedMessage || "첨부 파일을 확인하고 핵심 내용을 설명해 주세요.");

  if (premiereContext && Object.values(premiereContext).some(Boolean)) {
    parts.push([
      "[현재 Premiere 컨텍스트]",
      `- 프로젝트: ${premiereContext.projectName || "알 수 없음"}`,
      `- 프로젝트 경로: ${premiereContext.projectPath || "알 수 없음"}`,
      `- 활성 시퀀스: ${premiereContext.sequenceName || "없음"}`,
    ].join("\n"));
  }

  if (attachments.length) parts.push(attachmentPrompt(attachments));
  return parts.join("\n\n");
}

function attachmentPrompt(attachments: ChatAttachment[]): string {
  const sections = [
    "[사용자가 명시적으로 선택한 로컬 첨부 파일]",
    "아래 파일만 요청 범위로 취급하세요. 이미지와 바이너리는 제공된 경로를 파일/이미지 도구로 직접 확인하세요.",
  ];
  for (const attachment of attachments) {
    const header = `- ${attachment.kind.toUpperCase()}: ${attachment.name}\n  경로: ${attachment.nativePath}`;
    if (attachment.kind !== "text" || attachment.text === undefined) {
      sections.push(header);
      continue;
    }
    const truncation = attachment.truncated ? "\n  (안전한 전송 크기에 맞춰 뒤쪽을 생략함)" : "";
    sections.push(`${header}${truncation}\n\n--- ${attachment.name} 시작 ---\n${attachment.text}\n--- ${attachment.name} 끝 ---`);
  }
  return sections.join("\n\n");
}

export function renderMarkdown(text: string): string {
  return String(text || "")
    .split(/```/)
    .map((block, index) => index % 2 === 1 ? renderCodeBlock(block) : renderTextBlock(block))
    .join("") || "<p></p>";
}

function renderCodeBlock(block: string): string {
  const body = block.replace(/^[a-z0-9+#.-]*\n/i, "").replace(/\n$/, "");
  return `<pre><code>${escapeHtml(body)}</code></pre>`;
}

function renderTextBlock(block: string): string {
  const escaped = escapeHtml(block)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  let html = "";
  let listType: "ul" | "ol" | undefined;
  const closeList = (): void => {
    if (!listType) return;
    html += "</div>";
    listType = undefined;
  };
  for (const line of escaped.split("\n")) {
    const unordered = line.match(/^\s*[-*]\s+(.*)/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)/);
    const item = unordered?.[1] ?? ordered?.[1];
    const nextType = unordered ? "ul" : ordered ? "ol" : undefined;
    if (item !== undefined && nextType) {
      if (listType !== nextType) {
        closeList();
        html += `<div class="markdown-list markdown-list--${nextType}">`;
        listType = nextType;
      }
      const marker = nextType === "ul" ? "•" : `${countOrderedItems(html) + 1}.`;
      html += `<div class="markdown-list__item"><span>${marker}</span><div>${item}</div></div>`;
      continue;
    }
    closeList();
    if (line.trim()) html += `<p>${line}</p>`;
  }
  closeList();
  return html;
}

function countOrderedItems(html: string): number {
  const currentList = html.slice(html.lastIndexOf('<div class="markdown-list markdown-list--ol">'));
  return (currentList.match(/markdown-list__item/g) ?? []).length;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}
