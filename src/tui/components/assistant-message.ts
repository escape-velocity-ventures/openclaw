import { Container, Spacer } from "@mariozechner/pi-tui";
import { markdownTheme, theme } from "../theme/theme.js";
import { HyperlinkMarkdown } from "./hyperlink-markdown.js";

export class AssistantMessageComponent extends Container {
  private body: HyperlinkMarkdown;
  private currentTextLength = 0;

  constructor(text: string) {
    super();
    this.currentTextLength = text.length;
    this.body = new HyperlinkMarkdown(text, 1, 0, markdownTheme, {
      // Keep assistant body text in terminal default foreground so contrast
      // follows the user's terminal theme (dark or light).
      color: (line) => theme.assistantText(line),
    });
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setText(text: string) {
    this.currentTextLength = text.length;
    this.body.setText(text);
  }

  getTextLength(): number {
    return this.currentTextLength;
  }
}
