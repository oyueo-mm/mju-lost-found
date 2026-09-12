export default function Loading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card h-20 animate-pulse bg-sunken" />
      ))}
    </div>
  );
}
