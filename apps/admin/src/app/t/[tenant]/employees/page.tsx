import { canAssignRole, ROLE_PERMISSIONS } from "@rental/domain";
import { PERMISSIONS, ROLE_KEYS, type RoleKey } from "@rental/types";
import { ActionForm, Field, Hidden, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, PageHeader } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { inviteAction, revokeInviteAction, setMemberStatusAction, updateMemberAction } from "./actions";

export default async function EmployeesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "staff.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: members }, { data: branches }, { data: overrides }] = await Promise.all([
    db.from("memberships").select("*").eq("tenant_id", ctx.tenantId).order("role"),
    db.from("branches").select("id,name").eq("tenant_id", ctx.tenantId),
    db.from("membership_permission_overrides").select("*").eq("tenant_id", ctx.tenantId),
  ]);
  const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
  const { data: profiles } = userIds.length ? await db.from("profiles").select("id,first_name,last_name,phone").in("id", userIds) : { data: [] };
  const pm = new Map((profiles ?? []).map((p) => [p.id, p]));
  const manage = can(ctx, "staff.manage");
  const myRole = ctx.role === "PLATFORM_ADMIN" ? null : (ctx.role as RoleKey);
  const assignable = ROLE_KEYS.filter((r) => myRole && canAssignRole(myRole, r));
  const branchChecks = (selected: string[]) => (
    <fieldset><legend className="label">{t("admin.employees.branches")}</legend>
      <div className="flex flex-wrap gap-3 text-sm">{(branches ?? []).map((b) => <label key={b.id} className="flex items-center gap-1"><input type="checkbox" name="branches" value={b.id} defaultChecked={selected.includes(b.id)} />{b.name}</label>)}</div>
      <p className="mt-1 text-xs text-muted">{t("admin.employees.allBranchesHint")}</p></fieldset>
  );
  return (
    <>
      <PageHeader title={t("admin.nav.employees")} subtitle={t("admin.employees.subtitle")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {(members ?? []).map((m) => {
            const p = m.user_id ? pm.get(m.user_id) : null;
            const editable = manage && m.role !== "TENANT_OWNER" && m.user_id !== ctx.userId && myRole !== null && canAssignRole(myRole, m.role);
            const mine = (overrides ?? []).filter((o) => o.membership_id === m.id);
            return (
              <Card key={m.id} title={p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || m.invited_email || "—" : m.invited_email ?? "—"}
                actions={<span className="flex gap-2"><Badge>{t(`admin.roles.${m.role}`)}</Badge><Badge status={m.status === "ACTIVE" ? "CONFIRMED" : m.status === "SUSPENDED" ? "CANCELLED" : "PENDING_APPROVAL"}>{t(`admin.employees.status.${m.status}`)}</Badge></span>}>
                <p className="text-xs text-muted">{m.invited_email ?? ""} {p?.phone ? `· ${p.phone}` : ""} · {t("admin.employees.since")} {dt(m.created_at, ctx.timezone, lang)}
                  {m.status === "INVITED" && m.invite_expires_at ? ` · ${t("admin.employees.expires")} ${dt(m.invite_expires_at, ctx.timezone, lang)}` : ""}</p>
                {editable && m.status !== "INVITED" ? (
                  <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">{t("admin.employees.edit")}</summary>
                    <ActionForm action={updateMemberAction} lang={lang} submitLabel={t("admin.common.save")} className="mt-3 space-y-4">
                      <TenantFields slug={ctx.slug} /><Hidden name="membershipId" value={m.id} />
                      <Select label={t("admin.employees.role")} name="role" required defaultValue={m.role} options={assignable.map((r) => ({ value: r, label: t(`admin.roles.${r}`) }))} />
                      {branchChecks(m.branch_ids)}
                      <fieldset><legend className="label">{t("admin.employees.overrides")}</legend>
                        <div className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-2">{PERMISSIONS.map((perm) => {
                          const o = mine.find((x) => x.permission === perm);
                          const byRole = ROLE_PERMISSIONS[m.role].includes(perm);
                          return (
                            <label key={perm} className="flex items-center justify-between gap-2"><span className={byRole ? "" : "text-muted"}>{perm}</span>
                              <select name={`perm_${perm}`} defaultValue={o ? (o.granted ? "grant" : "revoke") : ""} className="field w-28 py-1 text-xs">
                                <option value="">{byRole ? t("admin.employees.roleDefaultOn") : t("admin.employees.roleDefaultOff")}</option><option value="grant">{t("admin.employees.grant")}</option><option value="revoke">{t("admin.employees.revoke")}</option></select></label>
                          );
                        })}</div></fieldset>
                    </ActionForm>
                    <ActionForm action={setMemberStatusAction} lang={lang} submitLabel={m.status === "ACTIVE" ? t("admin.employees.suspend") : t("admin.employees.reactivate")} variant={m.status === "ACTIVE" ? "danger" : "ghost"} className="mt-3" confirm={t("admin.common.confirm")}>
                      <TenantFields slug={ctx.slug} /><Hidden name="membershipId" value={m.id} /><Hidden name="status" value={m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                    </ActionForm>
                  </details>
                ) : null}
                {manage && m.status === "INVITED" ? (
                  <ActionForm action={revokeInviteAction} lang={lang} submitLabel={t("admin.employees.revokeInvite")} variant="danger" className="mt-3" confirm={t("admin.common.confirm")}><TenantFields slug={ctx.slug} /><Hidden name="membershipId" value={m.id} /></ActionForm>
                ) : null}
              </Card>
            );
          })}
        </div>
        {manage && assignable.length ? (
          <Card title={t("admin.employees.invite")}>
            <ActionForm action={inviteAction} lang={lang} submitLabel={t("admin.employees.sendInvite")} resetOnSuccess>
              <TenantFields slug={ctx.slug} />
              <Field label={t("auth.email")} name="email" type="email" required />
              <Select label={t("admin.employees.role")} name="role" required defaultValue="EMPLOYEE" options={assignable.map((r) => ({ value: r, label: t(`admin.roles.${r}`) }))} />
              {branchChecks([])}
              <p className="text-xs text-muted">{t("admin.employees.inviteHint")}</p>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
