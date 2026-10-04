import { VehicleCardSkeleton } from "@/components/vehicle-card";

export default function Loading() {
  return (
    <div className="container-page pt-10" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-28 w-full" />
      <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <VehicleCardSkeleton key={i} />)}</div>
    </div>
  );
}
