export function PeriodFilter({ from, to, labels }: { from: string; to: string; labels: { from: string; to: string; apply: string } }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor="from">{labels.from}</label><input id="from" name="from" type="date" defaultValue={from} className="field py-2" /></div>
      <div><label className="label" htmlFor="to">{labels.to}</label><input id="to" name="to" type="date" defaultValue={to} className="field py-2" /></div>
      <button className="btn-ghost px-4 py-2 text-sm">{labels.apply}</button>
    </form>
  );
}
