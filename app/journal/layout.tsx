import Header from "@/components/Header";

export default function JournalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <Header />
      {children}
    </div>
  );
}