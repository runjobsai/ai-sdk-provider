import type { ComponentType } from "react";

import Catalog, { meta as catalog } from "./catalog";
import catalogSource from "./catalog.tsx?raw";
import Chat, { meta as chat } from "./chat";
import chatSource from "./chat.tsx?raw";
import Embeddings, { meta as embeddings } from "./embeddings";
import embeddingsSource from "./embeddings.tsx?raw";
import GenerateText, { meta as generateText } from "./generate-text";
import generateTextSource from "./generate-text.tsx?raw";
import ObjectLab, { meta as object } from "./object";
import objectSource from "./object.tsx?raw";
import ServerTools, { meta as serverTools } from "./server-tools";
import serverToolsSource from "./server-tools.tsx?raw";
import StreamText, { meta as streamText } from "./stream-text";
import streamTextSource from "./stream-text.tsx?raw";
import Tools, { meta as tools } from "./tools";
import toolsSource from "./tools.tsx?raw";

export interface LabMeta {
  id: string;
  title: string;
  /** Shown under the title. Markdown-ish: `code` spans are rendered. */
  blurb: string;
  /** The API surface this lab is actually demonstrating. */
  api: string[];
}

export interface Lab extends LabMeta {
  Demo: ComponentType;
  /** The lab's own file, via Vite's `?raw`, so the page can show it. */
  source: string;
}

/**
 * Ordered roughly by how much has to work for each one to run: the
 * catalog needs no auth at all, `generateText` needs a token, and the
 * chat lab needs the whole stack.
 */
export const labs: Lab[] = [
  { ...catalog, Demo: Catalog, source: catalogSource },
  { ...generateText, Demo: GenerateText, source: generateTextSource },
  { ...streamText, Demo: StreamText, source: streamTextSource },
  { ...chat, Demo: Chat, source: chatSource },
  { ...tools, Demo: Tools, source: toolsSource },
  { ...serverTools, Demo: ServerTools, source: serverToolsSource },
  { ...object, Demo: ObjectLab, source: objectSource },
  { ...embeddings, Demo: Embeddings, source: embeddingsSource },
];
