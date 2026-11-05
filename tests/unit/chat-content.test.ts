import { describe, expect, it } from "vitest";
import {
  attachmentDirectories,
  buildModelPrompt,
  classifyAttachment,
  renderMarkdown,
  type ChatAttachment,
} from "../../apps/uxp-plugin/src/chat-content.js";

describe("chat attachments", () => {
  it.each([
    ["notes.txt", "text"],
    ["captions.SRT", "text"],
    ["reference.png", "image"],
    ["plate.PSD", "image"],
    ["edit.prproj", "file"],
  ] as const)("classifies %s as %s", (name, expected) => {
    expect(classifyAttachment(name)).toBe(expected);
  });

  it("deduplicates Windows and POSIX attachment parent directories", () => {
    const attachments: ChatAttachment[] = [
      { id: "1", name: "a.txt", kind: "text", nativePath: "C:\\work\\a.txt" },
      { id: "2", name: "b.png", kind: "image", nativePath: "C:\\work\\b.png" },
      { id: "3", name: "c.md", kind: "text", nativePath: "/tmp/reference/c.md" },
    ];
    expect(attachmentDirectories(attachments)).toEqual(["C:\\work", "/tmp/reference"]);
  });

  it("builds one bounded model prompt with context, text, and image paths", () => {
    const prompt = buildModelPrompt("이 자료를 요약해줘", [
      { id: "1", name: "notes.txt", kind: "text", nativePath: "C:\\work\\notes.txt", text: "hello", truncated: true },
      { id: "2", name: "frame.png", kind: "image", nativePath: "C:\\work\\frame.png" },
    ], {
      projectName: "demo.prproj",
      projectPath: "C:\\work\\demo.prproj",
      sequenceName: "WORKING__DEMO",
    });

    expect(prompt).toContain("이 자료를 요약해줘");
    expect(prompt).toContain("WORKING__DEMO");
    expect(prompt).toContain("notes.txt 시작");
    expect(prompt).toContain("hello");
    expect(prompt).toContain("뒤쪽을 생략");
    expect(prompt).toContain("C:\\work\\frame.png");
    expect(prompt).toContain("파일/이미지 도구");
  });
});

describe("assistant content rendering", () => {
  it("formats simple Markdown while escaping untrusted HTML", () => {
    const html = renderMarkdown("**ok**\n\n<script>alert(1)</script>\n\n```ts\nconst a = 1;\n```");
    expect(html).toContain("<strong>ok</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<pre><code>const a = 1;</code></pre>");
  });
});
