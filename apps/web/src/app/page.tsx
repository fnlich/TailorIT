// Placeholder home page; work package F5 replaces it with a redirect to /jobs.
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="rounded-surface border bg-surface p-8 shadow-soft">
        <h1 className="text-2xl font-bold">TailorIT</h1>
        <p className="mt-2 text-muted-foreground">Scaffold is running.</p>
        <button className="mt-4 h-9 rounded-control bg-primary px-4 text-sm font-medium text-white">Apply</button>
      </div>
    </main>
  );
}
