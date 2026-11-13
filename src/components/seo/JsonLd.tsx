/** <script type="application/ld+json"> for the builders of lib/jsonld (server component, static HTML). */
export function JsonLd({ data }: { data: Record<string, unknown> | null | (Record<string, unknown> | null)[] }) {
  const list = (Array.isArray(data) ? data : [data]).filter((d): d is Record<string, unknown> => !!d);
  return (
    <>
      {list.map((d, i) => (
        // «<» escaped: a string value can never close the script element
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, '\\u003c') }} />
      ))}
    </>
  );
}
