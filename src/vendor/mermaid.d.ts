// Type shim for the vendored mermaid tiny bundle.
declare module '*mermaid.tiny.min.js' {
  interface MermaidConfig {
    startOnLoad?: boolean;
    theme?: string;
    securityLevel?: string;
    [key: string]: unknown;
  }
  interface RenderResult {
    svg: string;
  }
  interface Mermaid {
    initialize(config: MermaidConfig): void;
    render(id: string, text: string): Promise<RenderResult>;
  }
  const mermaid: Mermaid;
  export default mermaid;
}
