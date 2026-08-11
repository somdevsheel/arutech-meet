"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminClass {
  id: string;
  title: string;
  subject: string | null;
  createdAt: string;
  _count: { students: number; sessions: number };
}

export default function AdminClassesPage() {
  const [classes, setClasses] = useState<AdminClass[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    apiFetch<{ classes: AdminClass[]; total: number }>("/admin/classes?take=50&skip=0").then((data) => {
      setClasses(data.classes);
      setTotal(data.total);
    });
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-white">Classes ({total})</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-slate-500">
            <th className="py-2">Title</th>
            <th className="py-2">Subject</th>
            <th className="py-2">Students</th>
            <th className="py-2">Sessions</th>
            <th className="py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c.id} className="border-b border-surface-border/50">
              <td className="py-2 text-white">{c.title}</td>
              <td className="py-2 text-slate-400">{c.subject ?? "—"}</td>
              <td className="py-2 text-slate-400">{c._count.students}</td>
              <td className="py-2 text-slate-400">{c._count.sessions}</td>
              <td className="py-2 text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {classes.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate-500">
                No classes yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
