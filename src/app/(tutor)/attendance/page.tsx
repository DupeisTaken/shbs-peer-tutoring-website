import Link from "next/link";

import { AttendanceForm } from "./_components/attendance-form";

export default function AttendancePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Submit attendance</h1>
        <Link href="/dashboard" className="text-sm text-indigo-600 underline">
          ← Dashboard
        </Link>
      </div>
      <AttendanceForm />
    </main>
  );
}
