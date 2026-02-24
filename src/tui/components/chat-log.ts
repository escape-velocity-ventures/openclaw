import type { Component } from "@mariozechner/pi-tui";
import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";
import { AssistantMessageComponent } from "./assistant-message.js";
import { ToolExecutionComponent } from "./tool-execution.js";
import { UserMessageComponent } from "./user-message.js";

export class ChatLog extends Container {
  private readonly maxComponents: number;
  private toolById = new Map<string, ToolExecutionComponent>();
  private streamingRuns = new Map<string, AssistantMessageComponent>();
  private toolsExpanded = false;
  scrollOffset = 0; // Lines scrolled up from bottom (0 = at bottom)
  private lastAutoScrollCheck = 0; // Track when we last auto-scrolled

  constructor(maxComponents = 180) {
    super();
    this.maxComponents = Math.max(20, Math.floor(maxComponents));
  }

  private dropComponentReferences(component: Component) {
    for (const [toolId, tool] of this.toolById.entries()) {
      if (tool === component) {
        this.toolById.delete(toolId);
      }
    }
    for (const [runId, message] of this.streamingRuns.entries()) {
      if (message === component) {
        this.streamingRuns.delete(runId);
      }
    }
  }

  private pruneOverflow() {
    while (this.children.length > this.maxComponents) {
      const oldest = this.children[0];
      if (!oldest) {
        return;
      }
      this.removeChild(oldest);
      this.dropComponentReferences(oldest);
    }
  }

  private append(component: Component) {
    const wasAtBottom = this.isAtBottom();
    this.addChild(component);
    this.pruneOverflow();

    // Auto-scroll to bottom if we were at bottom before adding content
    if (wasAtBottom) {
      this.scrollToBottom();
    }
  }

  clearAll() {
    this.clear();
    this.toolById.clear();
    this.streamingRuns.clear();
    this.scrollOffset = 0; // Reset scroll when clearing
  }

  addSystem(text: string) {
    this.append(new Spacer(1));
    this.append(new Text(theme.system(text), 1, 0));
  }

  addUser(text: string) {
    this.append(new UserMessageComponent(text));
  }

  private resolveRunId(runId?: string) {
    return runId ?? "default";
  }

  startAssistant(text: string, runId?: string) {
    const component = new AssistantMessageComponent(text);
    this.streamingRuns.set(this.resolveRunId(runId), component);
    this.append(component);
    return component;
  }

  updateAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      this.startAssistant(text, runId);
      return;
    }
    existing.setText(text);
  }

  finalizeAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (existing) {
      // Guard: don't replace streamed content with shorter finalized text.
      // The gateway final message can be shorter (e.g. compacted/trimmed),
      // which causes visible content to shrink and triggers a full redraw.
      if (text.length >= existing.getTextLength()) {
        existing.setText(text);
      }
      this.streamingRuns.delete(effectiveRunId);
      return;
    }
    this.append(new AssistantMessageComponent(text));
  }

  dropAssistant(runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      return;
    }
    this.removeChild(existing);
    this.streamingRuns.delete(effectiveRunId);
  }

  startTool(toolCallId: string, toolName: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (existing) {
      existing.setArgs(args);
      return existing;
    }
    const component = new ToolExecutionComponent(toolName, args);
    component.setExpanded(this.toolsExpanded);
    this.toolById.set(toolCallId, component);
    this.append(component);
    return component;
  }

  updateToolArgs(toolCallId: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setArgs(args);
  }

  updateToolResult(
    toolCallId: string,
    result: unknown,
    opts?: { isError?: boolean; partial?: boolean },
  ) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    if (opts?.partial) {
      existing.setPartialResult(result as Record<string, unknown>);
      return;
    }
    existing.setResult(result as Record<string, unknown>, {
      isError: opts?.isError,
    });
  }

  setToolsExpanded(expanded: boolean) {
    this.toolsExpanded = expanded;
    for (const tool of this.toolById.values()) {
      tool.setExpanded(expanded);
    }
  }

  // Scroll handling methods
  scrollUp(lines = 1) {
    const allLines = this.getAllRenderedLines();
    const maxScroll = Math.max(0, allLines.length - 5); // Keep at least 5 lines visible
    this.scrollOffset = Math.min(this.scrollOffset + lines, maxScroll);
  }

  scrollDown(lines = 1) {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
  }

  scrollToBottom() {
    this.scrollOffset = 0;
  }

  scrollPageUp(terminalHeight: number) {
    this.scrollUp(Math.max(1, terminalHeight - 2));
  }

  scrollPageDown(terminalHeight: number) {
    this.scrollDown(Math.max(1, terminalHeight - 2));
  }

  isAtBottom(): boolean {
    return this.scrollOffset === 0;
  }

  getScrollIndicator(): string | null {
    if (this.isAtBottom()) {
      return null;
    }
    const allLines = this.getAllRenderedLines();
    const totalLines = allLines.length;
    const scrollPercent = Math.round(((totalLines - this.scrollOffset) / totalLines) * 100);
    return `[↑ ${this.scrollOffset}/${totalLines} lines (${scrollPercent}%) - End to go to bottom]`;
  }

  private lastRenderWidth = 80;

  // Get all lines that would be rendered by all components
  getAllRenderedLines(): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      const renderedLines = child.render(this.lastRenderWidth);
      lines.push(...renderedLines);
    }
    return lines;
  }

  // Override render to apply scroll offset
  // pi-tui renders from the bottom of the viewport upward, showing the last N lines
  // that fit on screen. To scroll up, we trim lines from the end so pi-tui's viewport
  // shows older content.
  render(width: number): string[] {
    this.lastRenderWidth = width;
    const allLines: string[] = [];
    for (const child of this.children) {
      allLines.push(...child.render(width));
    }

    if (this.scrollOffset > 0 && allLines.length > 0) {
      // Remove scrollOffset lines from the end, exposing older content
      const endIndex = Math.max(1, allLines.length - this.scrollOffset);
      return allLines.slice(0, endIndex);
    }

    return allLines;
  }

  // Auto-scroll to bottom when new content is added (unless user has scrolled up)
  private autoScrollToBottomIfNeeded() {
    // Only auto-scroll if we were at the bottom before new content
    if (this.scrollOffset === 0) {
      this.lastAutoScrollCheck = Date.now();
    }
  }
}
