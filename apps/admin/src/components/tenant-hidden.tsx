/** Hidden fields every tenant server action expects (tenant slug + page to revalidate). */
export function TenantFields({ slug, path }: { slug: string; path?: string }) {
  return (
    <>
      <input type="hidden" name="_tenant" value={slug} />
      {path ? <input type="hidden" name="_path" value={path} /> : null}
    </>
  );
}
