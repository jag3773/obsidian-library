// Obsidian runs in Electron, where DOMParser is built in. Tests run in Node, so borrow linkedom's.
import { DOMParser } from "linkedom";

const g = globalThis as { DOMParser?: unknown };
g.DOMParser ??= DOMParser;
