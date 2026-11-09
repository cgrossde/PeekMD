import type { DocumentMeta } from '../store';

type MetaDisclosureProps = {
  meta: DocumentMeta;
};

export function MetaDisclosure({ meta }: MetaDisclosureProps) {
  return (
    <details className={`peekmd-meta-disclosure${meta.valid ? '' : ' is-invalid'}`}>
      <summary>
        {meta.valid ? 'Meta' : <><span aria-hidden="true">⚠ </span>Meta · invalid frontmatter</>}
      </summary>
      <pre><code>{meta.content}</code></pre>
    </details>
  );
}
