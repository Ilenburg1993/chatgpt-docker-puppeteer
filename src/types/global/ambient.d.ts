export {};

declare global {
  interface BaseDriver {
    [key: string]: unknown;
  }

  interface ExecutionEngine {
    [key: string]: unknown;
  }

  interface NERVBridge {
    [key: string]: unknown;
  }

  interface Telemetry {
    [key: string]: unknown;
  }

  interface Window {
    __wd_obs?: MutationObserver | null;
    __wd_last_change?: number;
    __STABILIZER_OBSERVERS?: MutationObserver[];
    __SADI_PULSE?: Record<string, number>;
  }

  interface Node {
    text?: string;
    tagName?: string;
    type?: string;
    innerText?: string;
    shadowRoot?: ShadowRoot | null;
    contentDocument?: Document | null;
    matches?: (selector: string) => boolean;
    getAttribute?: (name: string) => string | null;
    querySelectorAll?: (selectors: string) => NodeListOf<any>;
    outerHTML?: string;
    offsetParent?: Element | null;
    getClientRects?: () => DOMRectList;
    value?: string;
    innerHTML?: string;
    isContentEditable?: boolean;
    dispatchEvent?: (event: Event) => boolean;
    focus?: () => void;
    blur?: () => void;
    contains?: (node: Node | null) => boolean;
  }

  interface Element {
    text?: string;
    value?: string;
    innerText?: string;
  }

  interface Navigator {
    keyboard?: {
      getLayoutMap?: () => Promise<Map<string, string>>;
    };
  }

  class Frame {
    [key: string]: unknown;
  }
}
