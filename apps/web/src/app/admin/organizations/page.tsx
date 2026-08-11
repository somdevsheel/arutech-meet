"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  storageLimitBytes: string;
  createdAt: string;
  _count: { memberships: number; meetings: number };
}

export default function AdminOrganizationsPage() {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    apiFetch<{ organizations: AdminOrg[]; total: number }>("/admin/organizations?take=50&skip=0").then(
      (data) => {
        setOrgs(data.organizations);
        setTotal(data.total);
      },
    );
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-white">Organizations ({total})</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-slate-500">
            <th className="py-2">Name</th>
            <th className="py-2">Plan</th>
            <th className="py-2">Members</th>
            <th className="py-2">Meetings</th>
            <th className="py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((o) => (
            <tr key={o.id} className="border-b border-surface-border/50">
              <td className="py-2 text-white">{o.name}</td>
              <td className="py-2 text-slate-400">{o.plan}</td>
              <td className="py-2 text-slate-400">{o._count.memberships}</td>
              <td className="py-2 text-slate-400">{o._count.meetings}</td>
              <td className="py-2 text-slate-400">{new Date(o.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {orgs.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate-500">
                No organizations yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
